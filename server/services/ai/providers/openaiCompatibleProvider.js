// AI provider for every OpenAI-compatible Chat Completions API: the free
// providers (Google Gemini, Groq, OpenRouter, Pollinations, LLM7, local
// Ollama) and OpenAI itself. Only the base URL, model and key differ
// (see providerPresets.js).
import OpenAI from 'openai';
import { AiServiceError } from '../../../utils/AppError.js';
import { JSON_SHAPE_HINT } from '../promptTemplates.js';

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
  name, label, apiKey, model, baseUrl, headers, maxOutputTokens, timeoutMs, omitAuthWithoutKey,
}) {
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

  // timeLeftMs: the request must finish within the time left in the review's budget.
  async function complete(messages, jsonMode, timeLeftMs) {
    const options = timeLeftMs ? { timeout: Math.min(timeoutMs, timeLeftMs), maxRetries: 0 } : undefined;
    return client.chat.completions.create({
      model,
      messages,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      ...(maxOutputTokens ? { max_tokens: maxOutputTokens } : {}),
    }, options);
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

      let completion;
      try {
        completion = await complete(messages, true, timeLeftMs);
      } catch (error) {
        // Some free models do not support JSON mode; the prompt still asks for JSON.
        if (!isJsonModeUnsupported(error)) throw mapError(error);
        try {
          completion = await complete(messages, false, timeLeftMs);
        } catch (retryError) {
          throw mapError(retryError);
        }
      }

      const choice = completion.choices?.[0];
      if (choice?.finish_reason === 'length') {
        throw new AiServiceError('AI_TRUNCATED', 'stopped before finishing the answer (the code may be too long for this model).');
      }
      if (choice?.message?.refusal) {
        throw new AiServiceError('AI_REFUSED', 'declined to review this code.');
      }
      return { text: choice?.message?.content ?? '', model: completion.model || model };
    },
  };
}
