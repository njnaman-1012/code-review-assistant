// AI provider for every OpenAI-compatible Chat Completions API: the free
// providers (Google Gemini, Groq, OpenRouter, Pollinations, LLM7, local
// Ollama) and OpenAI itself. Only the base URL, model and key differ
// (see providerPresets.js).
import OpenAI from 'openai';
import { AiServiceError } from '../../../utils/AppError.js';
import { JSON_SHAPE_HINT } from '../promptTemplates.js';
import { logger } from '../../../utils/logger.js';

// Failures where another model of the same service may still answer: the
// model is overloaded (HTTP 503), rate-limited, no longer offered, or did not
// answer in time (an overloaded model sometimes just hangs).
const TRY_NEXT_MODEL = new Set(['AI_UNAVAILABLE', 'AI_RATE_LIMITED', 'AI_MODEL_NOT_FOUND', 'AI_TIMEOUT']);
// Do not start another model with less time than this left.
const MIN_MODEL_MS = 5000;
// A model that has fallback models behind it gets a shorter time limit, so a
// hanging model cannot use up the whole request: a base time plus extra time
// for long prompts (long code needs a long answer).
const MODEL_TIMEOUT_MS_PER_PROMPT_CHAR = 3;

function mapError(error) {
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new AiServiceError('AI_TIMEOUT', 'took too long to respond.', error);
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new AiServiceError('AI_UNAVAILABLE', 'could not be reached (check your internet connection).', error);
  }
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) {
    return new AiServiceError('AI_AUTH_FAILED', 'rejected the API key (check the key in server/.env).', error);
  }
  if (error instanceof OpenAI.NotFoundError) {
    return new AiServiceError('AI_MODEL_NOT_FOUND', 'does not know the configured model.', error);
  }
  if (error instanceof OpenAI.RateLimitError) {
    return new AiServiceError('AI_RATE_LIMITED', 'rate limit reached (free tiers allow a limited number of requests per minute/day).', error);
  }
  if (error instanceof OpenAI.BadRequestError) {
    return new AiServiceError('AI_BAD_REQUEST', 'rejected the request.', error);
  }
  if (error instanceof OpenAI.APIError) {
    return new AiServiceError('AI_UNAVAILABLE', `is temporarily unavailable (HTTP ${error.status ?? '?'}).`, error);
  }
  return new AiServiceError('AI_ERROR', 'returned an unexpected error.', error);
}

function isJsonModeUnsupported(error) {
  return error instanceof OpenAI.BadRequestError && /response_format|json/i.test(error.message ?? '');
}

export function createOpenAiCompatibleProvider({
  name, label, apiKey, model, fallbackModels = [], modelTimeoutMs, baseUrl, headers, maxOutputTokens, timeoutMs, omitAuthWithoutKey,
}) {
  const models = [model, ...fallbackModels.filter((other) => other && other !== model)];
  const defaultHeaders = { ...headers };
  // Some keyless services only allow anonymous use when no Authorization
  // header is sent at all (a null value removes the SDK's default header).
  if (!apiKey && omitAuthWithoutKey) defaultHeaders.Authorization = null;

  const client = new OpenAI({
    apiKey: apiKey || 'unused', // keyless providers accept any placeholder
    baseURL: baseUrl || undefined,
    defaultHeaders,
    timeout: timeoutMs,
    maxRetries: 1, // fail over to the next provider quickly instead of waiting
  });

  // The time one request may take:
  //   - never longer than the provider timeout or the time left in the review's budget (timeLeftMs)
  //   - shorter (modelTimeoutMs + extra for long prompts) when another model can still be tried
  // No automatic retry when there is a budget or a fallback model: the next model is the retry.
  function requestOptions(messages, timeLeftMs, hasNextModel) {
    const limits = [timeoutMs];
    if (timeLeftMs) limits.push(timeLeftMs);
    if (hasNextModel && modelTimeoutMs) {
      const promptChars = messages.reduce((sum, message) => sum + message.content.length, 0);
      limits.push(modelTimeoutMs + promptChars * MODEL_TIMEOUT_MS_PER_PROMPT_CHAR);
    }
    return { timeout: Math.min(...limits), maxRetries: timeLeftMs || models.length > 1 ? 0 : 1 };
  }

  async function complete(modelName, messages, jsonMode, options) {
    return client.chat.completions.create({
      model: modelName,
      messages,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      ...(maxOutputTokens ? { max_tokens: maxOutputTokens } : {}),
    }, options);
  }

  // One model: JSON mode first; some free models do not support it, the prompt still asks for JSON.
  async function completeWithModel(modelName, messages, options) {
    try {
      return await complete(modelName, messages, true, options);
    } catch (error) {
      if (!isJsonModeUnsupported(error)) throw mapError(error);
      try {
        return await complete(modelName, messages, false, options);
      } catch (retryError) {
        throw mapError(retryError);
      }
    }
  }

  // The default model first, then the fallback models of the same service.
  async function completeWithFallback(messages, timeLeftMs) {
    const deadline = timeLeftMs ? Date.now() + timeLeftMs : null;
    for (const [index, modelName] of models.entries()) {
      const hasNextModel = index < models.length - 1;
      try {
        const options = requestOptions(messages, deadline ? deadline - Date.now() : undefined, hasNextModel);
        return await completeWithModel(modelName, messages, options);
      } catch (error) {
        const isLast = !hasNextModel;
        const outOfTime = deadline !== null && deadline - Date.now() < MIN_MODEL_MS;
        if (isLast || outOfTime || !TRY_NEXT_MODEL.has(error.code)) throw error;
        logger.warn('AI model could not answer, trying another model of the same service', { provider: name, model: modelName, code: error.code });
      }
    }
    throw new AiServiceError('AI_ERROR', 'no model is configured.'); // not reachable: there is always one model
  }

  return {
    name,
    label,
    model,

    // `shapeHint` describes the expected JSON (the review shape by default,
    // or the shape of a code correction / improvement).
    async generateJson({ system, prompt, shapeHint = JSON_SHAPE_HINT, timeLeftMs }) {
      const messages = [
        { role: 'system', content: system },
        { role: 'user', content: `${prompt}\n\n${shapeHint}` },
      ];

      const completion = await completeWithFallback(messages, timeLeftMs);

      // Tokens the service reports for this request (charged to the user's allowance).
      const totalTokens = completion.usage?.total_tokens;
      const usage = Number.isFinite(totalTokens) ? { totalTokens } : undefined;

      const choice = completion.choices?.[0];
      if (choice?.finish_reason === 'length') {
        throw Object.assign(
          new AiServiceError('AI_TRUNCATED', 'stopped before finishing the answer (the code may be too long for this model).'),
          { tokensUsed: totalTokens },
        );
      }
      if (choice?.message?.refusal) {
        throw Object.assign(new AiServiceError('AI_REFUSED', 'declined to review this code.'), { tokensUsed: totalTokens });
      }
      return { text: choice?.message?.content ?? '', model: completion.model || model, usage };
    },
  };
}
