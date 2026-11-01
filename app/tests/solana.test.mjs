// Stage 2 unit gate for the Solana layer: message format, signature
// verification, exact amount maths, and the production RPC balance reader.
//
// Run: node app/tests/solana.test.mjs
//
// The balance reader is exercised through a stubbed fetch that answers exactly
// like a Solana JSON-RPC node, so the parsing path is real and no network is
// touched. Nothing here can move funds: verification is read-only.

import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

import {
  walletLinkMessage,
  verifyWalletSignature,
  formatUnits,
  parseUnits,
  createRpcBalanceReader,
} from '../lib/solana.js';

const passed = [];
const check = async (name, fn) => {
  await fn();
  passed.push(name);
  console.log(`  PASS  ${name}`);
};

const MINT = 'Ha6cqBCf5rCcka3M1BNK46BeBbZFbq5Mq1KgAjCmFiLE';
const ORIGIN = 'https://archive.file106.xyz';

// ---------------------------------------------------------------------
console.log('signed message');

await check('the message carries address, origin and nonce and nothing to move funds', async () => {
  const message = walletLinkMessage({
    address: 'So11111111111111111111111111111111111111112',
    nonce: 'f'.repeat(32),
    origin: ORIGIN,
  });

  assert.match(message, /^FILE106 ARCHIVE \| WALLET OWNERSHIP\n\n/);
  assert.ok(message.includes('Address: So11111111111111111111111111111111111111112'));
  assert.ok(message.includes(`Origin: ${ORIGIN}`));
  assert.ok(message.includes(`Nonce: ${'f'.repeat(32)}`));
  assert.match(message, /moves no funds/);
  assert.ok(!/undefined|NaN|\[object/.test(message), message);
});

await check('the same inputs always produce byte-identical text', async () => {
  const input = { address: 'So11111111111111111111111111111111111111112', nonce: 'a1b2c3', origin: ORIGIN };
  assert.equal(walletLinkMessage(input), walletLinkMessage(input));
});

console.log('signature verification');

const keypair = Keypair.generate();
const address = keypair.publicKey.toBase58();
const message = walletLinkMessage({ address, nonce: 'abc123', origin: ORIGIN });
const signature = bs58.encode(nacl.sign.detached(Buffer.from(message, 'utf8'), keypair.secretKey));

await check('a genuine ed25519 signature verifies', async () => {
  assert.equal(verifyWalletSignature({ message, signature, address }), true);
});

await check('a signature over a different message is refused', async () => {
  const other = bs58.encode(
    nacl.sign.detached(Buffer.from(message.replace('abc123', 'abc124'), 'utf8'), keypair.secretKey)
  );
  assert.equal(verifyWalletSignature({ message, signature: other, address }), false);
});

await check('a signature from another keypair is refused', async () => {
  const impostor = Keypair.generate();
  const forged = bs58.encode(nacl.sign.detached(Buffer.from(message, 'utf8'), impostor.secretKey));
  assert.equal(verifyWalletSignature({ message, signature: forged, address }), false);
});

await check('garbage never throws, it just fails', async () => {
  for (const bad of ['', 'not-base58-0OIl', '1111', bs58.encode(Buffer.alloc(32)), null, undefined]) {
    assert.equal(verifyWalletSignature({ message, signature: bad, address }), false);
  }
  assert.equal(
    verifyWalletSignature({ message, signature, address: 'So11111111111111111111111111111111111111112' }),
    false
  );
});

console.log('amount maths');

await check('base units format exactly at 8 decimals', async () => {
  assert.equal(formatUnits(0n, 8), '0.00000000');
  assert.equal(formatUnits(1n, 8), '0.00000001');
  assert.equal(formatUnits(99n, 8), '0.00000099');
  assert.equal(formatUnits(100000000n, 8), '1.00000000');
  assert.equal(formatUnits(150000000n, 8), '1.50000000');
  assert.equal(formatUnits(123456789012n, 8), '1234.56789012');
  assert.equal(formatUnits(75000000n, 8), '0.75000000');
  assert.equal(formatUnits(75000000n, 6), '75.000000');
  assert.equal(formatUnits(5n, 0), '5');
});

await check('large balances keep every digit', async () => {
  const huge = 123456789012345678901n;
  assert.equal(formatUnits(huge, 8), '1234567890123.45678901');
  assert.equal(parseUnits(formatUnits(huge, 8), 8), huge);
});

await check('negative and zero values survive a round trip', async () => {
  assert.equal(formatUnits(-250000000n, 8), '-2.50000000');
  assert.equal(parseUnits('-2.50000000', 8), -250000000n);
  assert.equal(parseUnits('0.00000000', 8), 0n);
});

await check('parsing refuses anything that is not an exact amount', async () => {
  assert.equal(parseUnits('1.5', 8), 150000000n);
  assert.equal(parseUnits('  2.25 ', 8), 225000000n);
  assert.equal(parseUnits('7', 0), 7n);

  for (const bad of ['', 'abc', '1.2.3', '1,5', '0.000000001', '1e8', '--1']) {
    assert.throws(() => parseUnits(bad, 8), /invalid amount|too many decimals/, `accepted ${bad}`);
  }
});

await check('a threshold comparison is exact, not floating point', async () => {
  // 0.1 + 0.2 !== 0.3 in floats; in base units it must be equal.
  assert.equal(parseUnits('0.1', 8) + parseUnits('0.2', 8), parseUnits('0.3', 8));
  const required = parseUnits('1.5', 8);
  assert.equal(parseUnits('1.49999999', 8) >= required, false);
  assert.equal(parseUnits('1.50000000', 8) >= required, true);
});

console.log('rpc balance reader');

function rpcStub({ accounts, capture }) {
  return async (url, init) => {
    const request = JSON.parse(init.body);
    if (capture) capture(request, url);

    const value = accounts.map((amount, index) => ({
      pubkey: bs58.encode(Buffer.alloc(32, index + 1)),
      account: {
        data: {
          parsed: { info: { mint: MINT, owner: 'owner', tokenAmount: { amount, decimals: 8 } } },
          program: 'spl-token',
          space: 165,
        },
        executable: false,
        lamports: 2039280,
        owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        rentEpoch: 0,
      },
    }));

    const payload = {
      jsonrpc: '2.0',
      id: request.id,
      result: { context: { slot: 1 }, value },
    };

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  };
}

await check('the reader sums every token account for the configured mint', async () => {
  const seen = [];
  const read = createRpcBalanceReader({
    rpcUrl: 'https://rpc.invalid',
    commitment: 'confirmed',
    mintAddress: MINT,
    decimals: 8,
    fetch: rpcStub({ accounts: ['100000000', '50000000'], capture: (request) => seen.push(request) }),
  });

  const balance = await read(address);
  assert.equal(balance.baseUnits, 150000000n);
  assert.equal(balance.amount, '1.50000000');
  assert.equal(balance.decimals, 8);

  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'getTokenAccountsByOwner');
  assert.equal(seen[0].params[0], address, 'the owner queried must be the address being checked');
  assert.equal(seen[0].params[1].mint, MINT, 'the mint filter must be the F106 mint, not any token');
});

await check('an owner with no token account reads as zero', async () => {
  const read = createRpcBalanceReader({
    rpcUrl: 'https://rpc.invalid',
    commitment: 'confirmed',
    mintAddress: MINT,
    decimals: 8,
    fetch: rpcStub({ accounts: [] }),
  });

  const balance = await read(address);
  assert.equal(balance.baseUnits, 0n);
  assert.equal(balance.amount, '0.00000000');
});

await check('an RPC error surfaces as a rejection the route can degrade on', async () => {
  const read = createRpcBalanceReader({
    rpcUrl: 'https://rpc.invalid',
    commitment: 'confirmed',
    mintAddress: MINT,
    decimals: 8,
    fetch: async () => {
      const payload = { jsonrpc: '2.0', id: 1, error: { code: -32005, message: 'Node is behind' } };
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      };
    },
  });

  await assert.rejects(() => read(address), /Node is behind|error/i);
});

console.log(`\n${passed.length} checks passed\n`);
