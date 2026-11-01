// Solana helpers. Everything here runs on the server: the browser is never
// trusted for a wallet address, a signature, or a balance.

import { Connection, PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

export const MESSAGE_DOMAIN = 'FILE106 ARCHIVE';

// The signed message is domain-separated and carries the nonce and origin, so
// a signature harvested for another purpose cannot be replayed here. The nonce
// is the freshness proof: it is single-use and short-lived, so no timestamp is
// needed, and leaving one out means the server can rebuild the exact string
// from the nonce row without depending on clock or timezone agreement.
export function walletLinkMessage({ address, nonce, origin }) {
  return [
    `${MESSAGE_DOMAIN} | WALLET OWNERSHIP`,
    '',
    `Address: ${address}`,
    `Origin: ${origin}`,
    `Nonce: ${nonce}`,
    '',
    'Signing this message proves you control this wallet.',
    'It does not authorise a transaction and moves no funds.',
  ].join('\n');
}

export function verifyWalletSignature({ message, signature, address }) {
  try {
    const signatureBytes = bs58.decode(String(signature));
    const addressBytes = bs58.decode(String(address));
    if (signatureBytes.length !== nacl.sign.signatureLength) return false;
    if (addressBytes.length !== nacl.sign.publicKeyLength) return false;
    return nacl.sign.detached.verify(Buffer.from(message, 'utf8'), signatureBytes, addressBytes);
  } catch {
    return false;
  }
}

// Converts base units to a fixed-point decimal string without floating point,
// so 0.75 F106 can never drift to 0.74999999.
export function formatUnits(baseUnits, decimals) {
  const value = BigInt(baseUnits);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const digits = absolute.toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals > 0 ? digits.slice(digits.length - decimals) : '';
  const joined = fraction ? `${whole}.${fraction}` : whole;
  return negative ? `-${joined}` : joined;
}

export function parseUnits(amount, decimals) {
  const text = String(amount ?? '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new Error(`invalid amount: ${text}`);
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
  if (fraction.length > decimals) throw new Error(`too many decimals: ${text}`);
  const base = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  return negative ? -base : base;
}

// Production balance reader: sums every token account the owner holds for the
// configured mint. A caller can never pass in a number of its own.
//
// `fetch` is injectable so the reader can be exercised against a recorded RPC
// response without a network call; production leaves it undefined and web3.js
// uses the platform fetch.
export function createRpcBalanceReader({ rpcUrl, commitment, mintAddress, decimals, fetch }) {
  const connection = new Connection(rpcUrl, fetch ? { commitment, fetch } : commitment);
  const mint = new PublicKey(mintAddress);

  return async function readBalance(ownerAddress) {
    const owner = new PublicKey(ownerAddress);
    const response = await connection.getParsedTokenAccountsByOwner(owner, { mint });

    let baseUnits = 0n;
    for (const entry of response.value) {
      const amount = entry.account?.data?.parsed?.info?.tokenAmount?.amount;
      if (amount) baseUnits += BigInt(amount);
    }

    return { baseUnits, amount: formatUnits(baseUnits, decimals), decimals };
  };
}
