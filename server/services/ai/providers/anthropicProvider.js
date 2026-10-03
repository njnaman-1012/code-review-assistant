// AI provider for Anthropic Claude (default), using the official SDK.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { AiServiceError } from '../../../utils/AppError.js';

// Newer Claude models run safety classifiers. With "fallbacks: default" a
// declined request is re-run server-side on a fallback model.
const FALLBACK_CAPABLE = /^claude-(opus-5|fable-5|mythos-5)/;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const STRUCTURED_OUTPUT_BETA = 'structured-outputs-2025-12-15';

function mapError(error) {
  // Most specific first: connection errors are subclasses of APIError.
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiServiceError('AI_TIMEOUT', 'The AI service took too long to respond.', error);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiServiceError('AI_UNAVAILABLE', 'Could not connect to the AI service. Check your internet connection.', error);
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AiServiceError('AI_AUTH_FAILED', 'The AI API key is invalid or does not have access. Check AI_API_KEY in server/.env.', error);
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new AiServiceError('AI_MODEL_NOT_FOUND', 'The configured AI model was not found. Check AI_MODEL in server/.env.', error);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiServiceError('AI_RATE_LIMITED', 'The AI service rate limit was reached. Please wait a minute and try again.', error);
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new AiServiceError('AI_BAD_REQUEST', 'The AI service rejected the request.', error);
  }
  if (error instanceof Anthropic.APIError) {
    if (error.status === 402) return new AiServiceError('AI_BILLING', 'The AI account has no remaining credit.', error);
    return new AiServiceError('AI_UNAVAILABLE', 'The AI service is temporarily unavailable. Please try again later.', error);
  }
  return new AiServiceError('AI_ERROR', 'An unexpected error occurred while contacting the AI service.', error);
}

export function createAnthropicProvider({ name = 'anthropic', label = 'Anthropic Claude', apiKey, model, maxOutputTokens, timeoutMs, refusalFallback }) {
  const client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 2 });
  const useFallback = refusalFallback && FALLBACK_CAPABLE.test(model);

  return {
    name,
    label,
    model,

    // Sends the prompt and returns the raw JSON text produced by the model.
    async generateJson({ system, prompt, schema, timeLeftMs }) {
      // Structured output: the API constrains the answer to this JSON schema.
      const params = {
        model,
        max_tokens: maxOutputTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
        output_config: { format: { type: 'json_schema', schema: zodOutputFormat(schema).schema } },
      };
      // The request must finish within the time left in the review's budget.
      const requestOptions = timeLeftMs ? { timeout: Math.min(timeoutMs, timeLeftMs), maxRetries: 0 } : undefined;

      let message;
      try {
        // Streaming avoids HTTP timeouts on long answers; finalMessage()
        // waits for the complete response.
        message = useFallback
          ? await client.beta.messages
            .stream({ ...params, betas: [FALLBACK_BETA, STRUCTURED_OUTPUT_BETA], fallbacks: 'default' }, requestOptions)
            .finalMessage()
          : await client.messages.stream(params, requestOptions).finalMessage();
      } catch (error) {
        throw mapError(error);
      }

      // Tokens the service reports for this request (charged to the user's allowance).
      const totalTokens = (message.usage?.input_tokens ?? 0) + (message.usage?.output_tokens ?? 0);

      if (message.stop_reason === 'refusal') {
        throw Object.assign(new AiServiceError('AI_REFUSED', 'The AI declined to review this code.'), { tokensUsed: totalTokens });
      }
      if (message.stop_reason === 'max_tokens') {
        throw Object.assign(
          new AiServiceError('AI_TRUNCATED', 'The AI response was cut off because the code is too long. Try a shorter program.'),
          { tokensUsed: totalTokens },
        );
      }

      const text = message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
      return { text, model: message.model, usage: totalTokens > 0 ? { totalTokens } : undefined };
    },
  };
}
