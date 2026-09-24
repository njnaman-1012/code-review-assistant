// Minimal logger. Never pass request bodies, source code or API keys to it.
function write(level, message, meta) {
  if (process.env.NODE_ENV === 'test') return;
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;
  const output = meta ? `${line} ${JSON.stringify(meta)}` : line;
  if (level === 'error') console.error(output);
  else if (level === 'warn') console.warn(output);
  else console.log(output);
}

export const logger = {
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
};
