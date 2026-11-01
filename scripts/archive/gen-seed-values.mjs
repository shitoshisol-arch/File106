// Generates the fixed test credentials embedded in db/seed/0001_devnet_seed.sql.
// Run: node scripts/archive/gen-seed-values.mjs
//
// Everything printed here is devnet-only test material. The wallet addresses
// carry no private keys (they are derived from throwaway random bytes and the
// keys are discarded), and the dev encryption key is deliberately public so the
// seed file stays reproducible.

import { randomBytes } from 'node:crypto';
import { answerDigest, hashSecret, sealAnswer } from './secret-hash.mjs';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58(buffer) {
  let value = BigInt('0x' + Buffer.from(buffer).toString('hex'));
  let out = '';
  while (value > 0n) {
    const rem = Number(value % 58n);
    value /= 58n;
    out = BASE58[rem] + out;
  }
  for (const byte of buffer) {
    if (byte !== 0) break;
    out = '1' + out;
  }
  return out;
}

// 32 random bytes is a valid ed25519 public key shape (32-44 base58 chars).
const wallet = () => base58(randomBytes(32));

const DEV_ENC_KEY = 'f106a5e1c0de0000f106a5e1c0de0000f106a5e1c0de0000f106a5e1c0de0000';

const out = {
  devEncKey: DEV_ENC_KEY,
  adminPasswordHash: hashSecret('archive-admin-dev'),
  userPasswordHash: hashSecret('archive-user-dev'),
  answers: {
    'file-106': hashSecret('classified'),
    'file-107': hashSecret('redacted'),
    'file-108': hashSecret('106'),
    'file-109': hashSecret('gaslight'),
  },
  wallets: {
    admin: wallet(),
    userA: wallet(),
    userB: wallet(),
  },
};

const sealed = sealAnswer('classified', DEV_ENC_KEY);

console.log(JSON.stringify({
  devEncKey: DEV_ENC_KEY,
  adminPasswordHash: out.adminPasswordHash,
  userPasswordHash: out.userPasswordHash,
  answers: out.answers,
  wallets: out.wallets,
  sampleSubmission: {
    ciphertextHex: sealed.toString('hex'),
    digestHex: answerDigest('classified', DEV_ENC_KEY).toString('hex'),
  },
}, null, 2));
