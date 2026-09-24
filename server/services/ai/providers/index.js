// Provider factory: turns the configured chain into provider objects that
// all share one interface { name, label, model, generateJson() }. The rest of
// the application never needs to know which AI service is behind it
// (Strategy pattern), so switching provider is a .env change, not a code change.
import { createAnthropicProvider } from './anthropicProvider.js';
import { createOpenAiCompatibleProvider } from './openaiCompatibleProvider.js';

export function createAiProviders(aiConfig) {
  const { chain, timeoutMs, maxOutputTokens, refusalFallback } = aiConfig;

  return chain.providers.map((entry) => {
    if (entry.kind === 'anthropic') {
      return createAnthropicProvider({ ...entry, maxOutputTokens, timeoutMs, refusalFallback });
    }
    // Slow free providers may define a longer timeout of their own.
    return createOpenAiCompatibleProvider({ ...entry, timeoutMs: entry.timeoutMs ?? timeoutMs });
  });
}
