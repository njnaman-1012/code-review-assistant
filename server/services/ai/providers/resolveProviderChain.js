// Turns environment variables into the ordered list of AI providers to try.
//
//   AI_PROVIDER=auto              -> every free provider that can be used (default)
//   AI_PROVIDER=gemini,groq       -> exactly these, in this order
//   AI_PROVIDER=anthropic         -> a single provider (AI_API_KEY / AI_MODEL also apply)
//   AI_PROVIDER=none              -> AI disabled, static analysis only
import { PROVIDER_PRESETS, AUTO_ORDER } from './providerPresets.js';

export function resolveProviderChain(env = process.env) {
  const setting = (env.AI_PROVIDER || 'auto').trim().toLowerCase();
  if (setting === 'none' || setting === 'off') return { providers: [], skipped: [] };

  const requested = setting === 'auto'
    ? AUTO_ORDER
    : setting.split(',').map((name) => name.trim()).filter(Boolean);
  const single = setting !== 'auto' && requested.length === 1;

  const providers = [];
  const skipped = [];

  for (const name of requested) {
    const preset = PROVIDER_PRESETS[name === 'openai-compatible' ? 'openai' : name];
    if (!preset) throw new Error(`Unknown AI provider "${name}". Valid values: auto, none, ${Object.keys(PROVIDER_PRESETS).join(', ')}.`);

    // The generic AI_API_KEY / AI_MODEL / AI_BASE_URL apply when one provider is chosen.
    const apiKey = (preset.keyEnv && env[preset.keyEnv]) || (single ? env.AI_API_KEY : '') || '';
    const model = (preset.modelEnv && env[preset.modelEnv]) || (single ? env.AI_MODEL : '') || preset.defaultModel;
    const baseUrl = (single && env.AI_BASE_URL) || preset.baseUrl;
    // e.g. GEMINI_FALLBACK_MODELS=gemini-3.5-flash,gemini-3.5-flash-lite ("none" turns it off)
    const fallbackSetting = preset.fallbackModelsEnv ? env[preset.fallbackModelsEnv] : undefined;
    const fallbackModels = (fallbackSetting ? fallbackSetting.split(',') : preset.fallbackModels ?? [])
      .map((name) => name.trim())
      .filter((name) => name && name.toLowerCase() !== 'none' && name !== model);

    if (preset.needsKey && !apiKey) {
      if (setting !== 'auto') skipped.push({ name, reason: `no API key (set ${preset.keyEnv || 'AI_API_KEY'})` });
      continue;
    }
    if (!model) {
      skipped.push({ name, reason: 'no model configured (set AI_MODEL)' });
      continue;
    }

    providers.push({
      name,
      label: preset.label,
      kind: preset.kind,
      free: preset.free,
      apiKey,
      model,
      fallbackModels,
      baseUrl,
      headers: preset.headers,
      maxOutputTokens: preset.maxOutputTokens,
      timeoutMs: preset.timeoutMs,
      omitAuthWithoutKey: preset.omitAuthWithoutKey,
    });
  }
  return { providers, skipped };
}
