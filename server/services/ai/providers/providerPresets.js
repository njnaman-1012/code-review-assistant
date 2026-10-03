// Ready-made settings for every supported AI provider. Most of them speak
// the OpenAI "chat completions" API, so one adapter
// (openaiCompatibleProvider.js) serves all of them - only the URL, model and
// key differ.
//
//   free: true   -> no payment needed
//   needsKey     -> a (free) API key is required; keyless ones work out of the box
//   fallbackModels -> other models of the same service (same key), tried in
//                     order when the default model is overloaded or rate-limited

export const PROVIDER_PRESETS = {
  gemini: {
    label: 'Google Gemini (free tier)',
    kind: 'openai-compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    defaultModel: 'gemini-3.8-flash',
    // Google often answers "503 - this model is experiencing high demand" for
    // one model while the others work; each model also has its own free quota.
    fallbackModels: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'],
    fallbackModelsEnv: 'GEMINI_FALLBACK_MODELS',
    keyEnv: 'GEMINI_API_KEY',
    modelEnv: 'GEMINI_MODEL',
    needsKey: true,
    free: true,
    signupUrl: 'https://aistudio.google.com/app/apikey',
  },
  groq: {
    label: 'Groq (free tier)',
    kind: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'openai/gpt-oss-120b',
    keyEnv: 'GROQ_API_KEY',
    modelEnv: 'GROQ_MODEL',
    needsKey: true,
    free: true,
    // The free tier allows ~8,000 tokens per minute, so keep answers compact.
    maxOutputTokens: 6000,
    signupUrl: 'https://console.groq.com/keys',
  },
  openrouter: {
    label: 'OpenRouter (free models)',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/free', // OpenRouter picks an available free model
    keyEnv: 'OPENROUTER_API_KEY',
    modelEnv: 'OPENROUTER_MODEL',
    needsKey: true,
    free: true,
    headers: { 'X-Title': 'Code Review Assistant' },
    signupUrl: 'https://openrouter.ai/keys',
  },
  // Keyless: anonymous access is allowed when NO Authorization header is sent.
  // Qwen3-Coder is a strong code model; the anonymous tier is slow (1-3 minutes)
  // and allows about 2 requests per minute.
  ovh: {
    label: 'OVHcloud AI Endpoints (free, no key)',
    kind: 'openai-compatible',
    baseUrl: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1',
    defaultModel: 'Qwen3-Coder-30B-A3B-Instruct',
    keyEnv: 'OVH_AI_ENDPOINTS_ACCESS_TOKEN', // optional
    modelEnv: 'OVH_MODEL',
    needsKey: false,
    free: true,
    omitAuthWithoutKey: true,
    timeoutMs: 240000,
    signupUrl: 'https://endpoints.ai.cloud.ovh.net',
  },
  // Keyless, but the anonymous tier stops every answer at ~1,500 tokens, which
  // is too short for a complete review. Not used by AI_PROVIDER=auto.
  pollinations: {
    label: 'Pollinations (free)',
    kind: 'openai-compatible',
    baseUrl: 'https://text.pollinations.ai/openai',
    defaultModel: 'openai', // GPT-OSS 20B
    keyEnv: 'POLLINATIONS_API_KEY', // optional
    modelEnv: 'POLLINATIONS_MODEL',
    needsKey: false,
    free: true,
    signupUrl: 'https://enter.pollinations.ai',
  },
  llm7: {
    label: 'LLM7 (free, no key)',
    kind: 'openai-compatible',
    baseUrl: 'https://api.llm7.io/v1',
    // Mistral's code model. Keyless answers are capped at ~3,000 tokens, so a
    // non-reasoning model is used (reasoning models spend the budget "thinking").
    defaultModel: 'codestral-latest',
    keyEnv: 'LLM7_API_KEY', // optional free token raises the rate limit
    modelEnv: 'LLM7_MODEL',
    needsKey: false,
    free: true,
    signupUrl: 'https://token.llm7.io',
  },
  ollama: {
    label: 'Ollama (local, free)',
    kind: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5-coder:7b',
    keyEnv: null,
    modelEnv: 'OLLAMA_MODEL',
    needsKey: false,
    free: true,
    signupUrl: 'https://ollama.com/download',
  },
  openai: {
    label: 'OpenAI-compatible API',
    kind: 'openai-compatible',
    baseUrl: '', // from AI_BASE_URL (empty = api.openai.com)
    defaultModel: '',
    keyEnv: 'OPENAI_API_KEY',
    modelEnv: null,
    needsKey: true,
    free: false,
  },
  anthropic: {
    label: 'Anthropic Claude (paid)',
    kind: 'anthropic',
    baseUrl: '',
    defaultModel: 'claude-opus-5',
    keyEnv: 'ANTHROPIC_API_KEY',
    modelEnv: 'ANTHROPIC_MODEL',
    needsKey: true,
    free: false,
    signupUrl: 'https://console.anthropic.com',
  },
};

// AI_PROVIDER=auto tries these in order. Providers that need a key are only
// used when their key is set; the keyless ones make AI review work with zero
// setup. Paid and local providers are never chosen automatically.
export const AUTO_ORDER = ['gemini', 'groq', 'openrouter', 'ovh', 'llm7'];
