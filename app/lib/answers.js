// Puzzle answers are write-only for everyone who is not the answerer.
//
// The plaintext is normalised under the challenge's own case rule, then hashed
// with salted scrypt exactly like a password. Three consequences follow, and all
// three are the point:
//
//   1. No query used by a page or an API selects answer_hash. The column is
//      fetched only by the submission path, which runs on the server.
//   2. A database dump does not yield answers. The salt and parameters differ
//      per row, so hashes cannot even be compared across challenges.
//   3. An admin cannot read back an answer they typed months ago. That is
//      intentional: rotating an answer means setting a new one, and the
//      database trigger refuses that once a file has been contested.

import { hashSecret, normalizeAnswer, verifySecret } from '../../scripts/archive/secret-hash.mjs';

// Recognisable prefix, so a test can assert that a hash never reaches a page.
export const ANSWER_HASH_PREFIX = 'scrypt$';

export function hashChallengeAnswer(answer, { caseSensitive = false } = {}) {
  return hashSecret(normalizeAnswer(answer, { caseSensitive }));
}

export function challengeAnswerMatches(input, storedHash, { caseSensitive = false } = {}) {
  if (typeof storedHash !== 'string' || !storedHash.startsWith(ANSWER_HASH_PREFIX)) return false;
  return verifySecret(normalizeAnswer(input, { caseSensitive }), storedHash);
}
