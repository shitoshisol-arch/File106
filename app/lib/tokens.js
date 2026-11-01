import { createHash, randomBytes } from 'node:crypto';

// Emailed secrets (verification, password reset) are stored only as SHA-256
// digests, so a database dump cannot be used to take over accounts.
export const randomToken = () => randomBytes(32).toString('hex');
export const hashToken = (token) => createHash('sha256').update(String(token)).digest();
export const randomNonce = () => randomBytes(16).toString('hex');

// Wallet nonces live in auth_nonces and are single-use: the row is consumed on
// success, so the same signature cannot be replayed.
export async function issueNonce(db, { purpose, userId = null, walletAddress = null, ipHash = null, ttlSeconds = 600 }) {
  const nonce = randomNonce();
  await db.query(
    `insert into auth_nonces (nonce, purpose, wallet_address, user_id, expires_at, ip_hash)
     values ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval, $6)`,
    [nonce, purpose, walletAddress, userId, String(ttlSeconds), ipHash]
  );
  return nonce;
}

// Returns the nonce row only if it is unexpired and unused, then marks it
// consumed in the same statement so two concurrent requests cannot both win.
export async function consumeNonce(db, { nonce, purpose, userId }) {
  const row = await db.one(
    `update auth_nonces
        set consumed_at = now()
      where nonce = $1
        and purpose = $2
        and consumed_at is null
        and expires_at > now()
        and ($3::uuid is null or user_id = $3::uuid)
      returning nonce, user_id, expires_at`,
    [nonce, purpose, userId]
  );
  return row;
}
