// Rough size of a text in AI tokens (about 4 characters per token). Used to
// estimate a request before it is sent, and when an AI service does not
// report how many tokens it used.
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / CHARS_PER_TOKEN);
}
