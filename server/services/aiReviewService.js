// AI REVIEW ENGINE - builds the prompts, calls the AI providers in order,
// validates the JSON answers and falls back to the next provider on failure.
// It offers three separate operations that share the same machinery:
//
//   reviewCode()  - the code review (explanation, issues, suggestions, ...)
//   correctCode() - "Fix / Correct Code": the complete corrected source file
//   improveCode() - "Improve Code": the complete improved source file
//
//   for each provider in the chain (e.g. Gemini -> OVHcloud -> LLM7):
//       ask (retry once, with the reason, if the answer is unusable)
//       success -> return it
//       failure (rate limit, timeout, bad JSON, incomplete code, ...) -> try the next provider
//   all failed -> AiServiceError
import {
  SYSTEM_PROMPT, buildReviewPrompt, buildRetryNote,
  CODE_ACTION_SYSTEM_PROMPT, buildCodeActionPrompt, codeActionShapeHint,
} from './ai/promptTemplates.js';
import { aiReviewSchema, aiCorrectionSchema, aiImprovementSchema } from './ai/reviewSchema.js';
import { validateAiReview, validateCodeAction } from './ai/aiResponseValidator.js';
import { AiServiceError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

const ATTEMPTS_PER_PROVIDER = 2;

function outOfTime(deadline) {
  return deadline && Date.now() > deadline;
}

// One provider: ask, validate the answer, and ask once more (explaining what
// was wrong) if the answer cannot be used.
async function runWithProvider(provider, task) {
  let prompt = task.prompt;
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS_PER_PROVIDER; attempt += 1) {
    if (attempt > 1 && outOfTime(task.deadline)) break;
    const started = Date.now();
    const response = await provider.generateJson({
      system: task.system, prompt, schema: task.schema, shapeHint: task.shapeHint, operation: task.operation,
    });
    try {
      const result = await task.validate(response.text);
      logger.info(`AI ${task.operation} completed`, { provider: provider.name, model: response.model, attempt, ms: Date.now() - started });
      return { result, model: response.model || provider.model };
    } catch (error) {
      if (!(error instanceof AiServiceError)) throw error;
      lastError = error;
      logger.warn('AI response failed validation', { operation: task.operation, provider: provider.name, attempt, reason: error.userMessage });
      prompt = task.prompt + buildRetryNote(error.userMessage);
    }
  }
  throw lastError;
}

// `providers` is an array (possibly empty); a single provider object is also accepted.
// `skipped` lists configured providers that could not be used (e.g. missing key).
export function createAiReviewService(providers, { skipped = [] } = {}) {
  const chain = (Array.isArray(providers) ? providers : [providers]).filter(Boolean);

  function unavailableReason() {
    return skipped.length
      ? `No AI provider could be used (${skipped.map((s) => `${s.name}: ${s.reason}`).join('; ')}). Set AI_PROVIDER=auto in server/.env for the free providers.`
      : 'AI analysis is turned off (AI_PROVIDER=none in server/.env).';
  }

  // Runs one AI operation on the provider chain with failover.
  async function runOnChain(task) {
    if (!chain.length) {
      throw new AiServiceError('AI_NOT_CONFIGURED', unavailableReason());
    }

    const failures = [];
    let lastError;
    for (const provider of chain) {
      if (outOfTime(task.deadline)) {
        lastError = new AiServiceError('AI_TIMEOUT', 'ran out of time before a provider returned a usable answer.');
        break;
      }
      const label = provider.label ?? provider.name;
      try {
        const answer = await runWithProvider(provider, task);
        return { ...answer, provider: label, failedProviders: failures };
      } catch (error) {
        if (!(error instanceof AiServiceError)) throw error;
        lastError = error;
        failures.push(`${label}: ${error.userMessage}`);
        logger.warn('AI provider failed, trying the next one', { operation: task.operation, provider: provider.name, code: error.code });
      }
    }

    const summary = failures.length === 1 ? failures[0] : `All AI providers failed - ${failures.join(' | ') || lastError?.userMessage}`;
    throw new AiServiceError(lastError?.code ?? 'AI_ERROR', summary);
  }

  // "Fix / Correct Code" and "Improve Code". `verify(code)` runs extra checks
  // on the returned source file (completeness, language, syntax); if it throws
  // an AiServiceError the answer is rejected and the AI is asked again.
  async function generateCode(action, { language, code, review, verify, deadline }) {
    const { result, ...meta } = await runOnChain({
      operation: action,
      system: CODE_ACTION_SYSTEM_PROMPT,
      prompt: buildCodeActionPrompt({ action, language, code, review }),
      schema: action === 'correct' ? aiCorrectionSchema : aiImprovementSchema,
      shapeHint: codeActionShapeHint(action, language),
      deadline,
      validate: async (text) => {
        const answer = validateCodeAction(text, { action, language });
        const checks = verify ? await verify(answer.code) : null;
        return { ...answer, checks };
      },
    });
    return { ...result, ...meta };
  }

  return {
    isAvailable() {
      return chain.length > 0;
    },

    info() {
      const first = chain[0];
      return {
        provider: first?.label ?? first?.name ?? null,
        model: first?.model ?? null,
        chain: chain.map((p) => ({ name: p.name, label: p.label ?? p.name, model: p.model })),
        unavailableReason: chain.length ? null : unavailableReason(),
      };
    },

    async reviewCode({ language, code, staticResult }) {
      const { result, ...meta } = await runOnChain({
        operation: 'review',
        system: SYSTEM_PROMPT,
        prompt: buildReviewPrompt({ language, code, staticResult }),
        schema: aiReviewSchema,
        validate: (text) => validateAiReview(text),
      });
      return { review: result, ...meta };
    },

    correctCode(options) {
      return generateCode('correct', options);
    },

    improveCode(options) {
      return generateCode('improve', options);
    },
  };
}
