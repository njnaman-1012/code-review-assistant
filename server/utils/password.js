// Password hashing. A password is never stored or logged; only a salted hash
// that describes itself is saved, for example
//   argon2id$m=19456,t=2,p=1$<salt>$<hash>
//
// Argon2id (built into Node.js 24.7+) is used when the runtime has it; older
// runtimes use scrypt, which is also memory-hard. Both come with Node.js, so
// there is no native package to install or build on the host. A hash made
// with older settings is still accepted and replaced at the next login.
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(crypto.scrypt);
const argon2Async = typeof crypto.argon2 === 'function' ? promisify(crypto.argon2) : null;

// Settings recommended by the OWASP Password Storage Cheat Sheet.
const ARGON2 = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 }; // 19 MiB
const SCRYPT = { N: 32768, r: 8, p: 3, keyLength: 64 };
const LEGACY_SCRYPT = { N: 16384, r: 8, p: 1 }; // "scrypt$<salt>$<hash>" of the first version
const SCRYPT_MAX_MEMORY = 128 * 1024 * 1024;

const argon2Settings = `m=${ARGON2.memory},t=${ARGON2.passes},p=${ARGON2.parallelism}`;
const scryptSettings = `N=${SCRYPT.N},r=${SCRYPT.r},p=${SCRYPT.p}`;

// "m=19456,t=2,p=1" -> { m: 19456, t: 2, p: 1 }; null when a value is missing or not a number.
function parseSettings(text, names) {
  const values = Object.fromEntries(text.split(',').map((part) => part.split('=')));
  const settings = {};
  for (const name of names) {
    const value = Number(values[name]);
    if (!Number.isInteger(value) || value <= 0) return null;
    settings[name] = value;
  }
  return settings;
}

function argon2Hash(password, salt, { m, t, p }, length) {
  return argon2Async('argon2id', { message: Buffer.from(password, 'utf8'), nonce: salt, memory: m, passes: t, parallelism: p, tagLength: length });
}

function scryptHash(password, salt, { N, r, p }, length) {
  return scryptAsync(password, salt, length, { N, r, p, maxmem: SCRYPT_MAX_MEMORY });
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  if (argon2Async) {
    const hash = await argon2Hash(password, salt, { m: ARGON2.memory, t: ARGON2.passes, p: ARGON2.parallelism }, ARGON2.tagLength);
    return `argon2id$${argon2Settings}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
  }
  const hash = await scryptHash(password, salt, SCRYPT, SCRYPT.keyLength);
  return `scrypt$${scryptSettings}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  let expected;
  let actual;
  try {
    if (parts[0] === 'argon2id' && parts.length === 4 && argon2Async) {
      const settings = parseSettings(parts[1], ['m', 't', 'p']);
      if (!settings) return false;
      expected = Buffer.from(parts[3], 'base64url');
      actual = await argon2Hash(password, Buffer.from(parts[2], 'base64url'), settings, expected.length);
    } else if (parts[0] === 'scrypt' && (parts.length === 3 || parts.length === 4)) {
      const settings = parts.length === 4 ? parseSettings(parts[1], ['N', 'r', 'p']) : LEGACY_SCRYPT;
      if (!settings) return false;
      expected = Buffer.from(parts.at(-1), 'hex');
      actual = await scryptHash(password, Buffer.from(parts.at(-2), 'hex'), settings, expected.length);
    } else {
      return false;
    }
  } catch {
    return false; // a damaged hash never matches
  }
  return expected.length > 0 && expected.length === actual.length && crypto.timingSafeEqual(actual, expected); // constant-time comparison
}

// True when the hash was not made with the current algorithm and settings.
export function needsRehash(stored) {
  const prefix = argon2Async ? `argon2id$${argon2Settings}$` : `scrypt$${scryptSettings}$`;
  return !String(stored ?? '').startsWith(prefix);
}
