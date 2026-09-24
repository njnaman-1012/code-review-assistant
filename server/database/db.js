// Opens the database and makes sure the schema exists.
//
// The same SQLite database is used in two ways (libSQL client):
//   - locally: a file, server/database/code_review.db
//   - on Vercel: a free hosted Turso database (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN),
//     because serverless functions cannot keep a local file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');

// `url` is ':memory:', a file: URL, or a remote libsql:// / https:// URL.
export async function createDatabase({ url, authToken }) {
  const isLocalFile = url.startsWith('file:');
  if (isLocalFile) {
    fs.mkdirSync(path.dirname(fileURLToPath(url)), { recursive: true });
  }

  // A remote database only needs the HTTP client (plain JavaScript); the
  // local-file client uses a native module and is loaded only when needed.
  const isRemote = /^(libsql|https?|wss?):/.test(url);
  const { createClient } = isRemote ? await import('@libsql/client/web') : await import('@libsql/client');
  const db = createClient({ url, authToken: authToken || undefined });
  if (isLocalFile) await db.execute('PRAGMA journal_mode = WAL'); // better concurrency for reads during writes
  if (url.startsWith('file:') || url === ':memory:') await db.execute('PRAGMA foreign_keys = ON');
  await db.executeMultiple(fs.readFileSync(schemaPath, 'utf8'));
  return db;
}

export async function isDatabaseHealthy(db) {
  try {
    const result = await db.execute('SELECT 1 AS ok');
    return result.rows[0].ok === 1;
  } catch {
    return false;
  }
}
