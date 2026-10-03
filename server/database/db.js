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
  await migrate(db);
  return db;
}

async function hasColumn(db, table, column) {
  const { rows } = await db.execute(`PRAGMA table_info(${table})`);
  return rows.some((row) => row.name === column);
}

// Adds a column that an earlier version did not have. `after` are statements
// that run together with it (one transaction). Two server instances may start
// at the same time; the second one finds the column already added.
async function addColumn(db, table, column, definition, after = []) {
  if (await hasColumn(db, table, column)) return;
  try {
    await db.batch([`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, ...after], 'write');
  } catch (error) {
    if (!/duplicate column/i.test(error.message ?? '')) throw error;
  }
}

// Brings a database created by an earlier version up to date. No row is deleted.
async function migrate(db) {
  // Reviews saved before user accounts existed have no owner (user_id NULL), so no user can see them.
  await addColumn(db, 'reviews', 'user_id', 'INTEGER REFERENCES users (id) ON DELETE CASCADE');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews (user_id, created_at DESC)');

  // Accounts created before e-mail verification existed stay usable: they are marked as verified.
  await addColumn(db, 'users', 'email_verified', 'INTEGER NOT NULL DEFAULT 0', ['UPDATE users SET email_verified = 1']);
  await addColumn(db, 'users', 'disabled', 'INTEGER NOT NULL DEFAULT 0');
}

export async function isDatabaseHealthy(db) {
  try {
    const result = await db.execute('SELECT 1 AS ok');
    return result.rows[0].ok === 1;
  } catch {
    return false;
  }
}
