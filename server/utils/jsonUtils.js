// Helpers for columns that store lists or nested objects as JSON text.

export function toJson(value, fallback) {
  return JSON.stringify(value ?? fallback);
}

export function fromJson(text, fallback) {
  if (text === null || text === undefined || text === '') return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}
