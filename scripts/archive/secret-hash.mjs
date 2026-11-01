// FILE106 ARCHIVE — secret handling primitives.
//
// Two jobs, both dependency-free on purpose (node:crypto only):
//   1. Puzzle answers are stored as scrypt hashes and compared server-side.
//   2. Submitted answers are stored as AES-256-GCM ciphertext, so a database
//      dump does not hand anyone a list of participants' answers.
//
// scrypt is used instead of argon2id because it needs no native build step on
// the Windows dev machine or the VPS image. The stored string carries its own
// parameters, so moving to argon2id later is a rehash-on-login migration.
//
// Answer hash format:  scrypt$<N>$<r>$<p>$<saltB64url>$<hashB64url>

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

const DEFAULT_PARAMS = { N: 32768, r: 8, p: 1, keylen: 32 };
const MAXMEM = 128 * 1024 * 1024;

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

// Puzzle answers are normalised before hashing so "  Classified " and
// "classified" are the same answer when the challenge is case-insensitive.
export function normalizeAnswer(answer, { caseSensitive = false } = {}) {
  const collapsed = String(answer ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
  return caseSensitive ? collapsed : collapsed.toLowerCase();
}

export function hashSecret(secret, params = {}) {
  const { N, r, p, keylen } = { ...DEFAULT_PARAMS, ...params };
  const salt = randomBytes(16);
  const derived = scryptSync(String(secret).normalize('NFKC'), salt, keylen, { N, r, p, maxmem: MAXMEM });
  return ['scrypt', N, r, p, b64url(salt), b64url(derived)].join('$');
}

export function verifySecret(secret, stored) {
  if (typeof stored !== 'string') return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let expected;
  let salt;
  try {
    salt = Buffer.from(saltRaw, 'base64url');
    expected = Buffer.from(hashRaw, 'base64url');
  } catch {
    return false;
  }

  const derived = scryptSync(String(secret).normalize('NFKC'), salt, expected.length, {
    N,
    r,
    p,
    maxmem: MAXMEM,
  });

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

function loadKey(keyHex) {
  const key = Buffer.from(String(keyHex ?? '').trim(), 'hex');
  if (key.length !== 32) {
    throw new Error('ANSWER_ENC_KEY must be 64 hex characters (32 bytes)');
  }
  return key;
}

// Returns iv + authTag + ciphertext as one blob: [12][16][n]
export function sealAnswer(plaintext, keyHex) {
  const key = loadKey(keyHex);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function openAnswer(blob, keyHex) {
  const key = loadKey(keyHex);
  const buffer = Buffer.from(blob);
  if (buffer.length < 28) throw new Error('sealed answer is truncated');

  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const body = buffer.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

// Duplicate/abuse detection without decryption: equal answers produce equal
// digests, and the digest cannot be reversed without the key.
export function answerDigest(plaintext, keyHex) {
  return createHmac('sha256', loadKey(keyHex))
    .update(normalizeAnswer(plaintext).normalize('NFKC'))
    .digest();
}

// CLI: node scripts/archive/secret-hash.mjs <secret>
if (process.argv[1] && process.argv[1].endsWith('secret-hash.mjs')) {
  const secret = process.argv[2];
  if (!secret) {
    console.error('usage: node scripts/archive/secret-hash.mjs <secret>');
    process.exit(1);
  }
  console.log(hashSecret(secret));
}
