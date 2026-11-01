// Wallet linking and balance reads.
//
// Order matters and is enforced here, not in the browser: a nonce is issued for
// one address, the signature is verified against that nonce, the nonce is then
// consumed, and only after all of that does a wallet row exist. The balance
// always comes from the server-side RPC reader.

import { issueNonce } from '../lib/tokens.js';
import { walletLinkMessage, verifyWalletSignature } from '../lib/solana.js';
import { validateWalletLink } from '../lib/validate.js';
import { ipHash } from '../lib/ip.js';

function requireUser(request, reply) {
  if (!request.user) {
    return reply.code(401).send({ error: 'login_required', message: 'Sign in first.' });
  }
  return null;
}

export async function walletRoutes(app, { db, config, balanceReader }) {
  app.post('/api/wallet/challenge', async (request, reply) => {
    if (requireUser(request, reply)) return reply;

    const address = String(request.body?.address ?? '').trim();
    const { errors } = validateWalletLink({ address, signature: 'x', nonce: '0'.repeat(32) });
    if (errors.address) {
      return reply.code(400).send({ error: 'invalid_address', message: errors.address });
    }

    const nonce = await issueNonce(db, {
      purpose: 'wallet_link',
      userId: request.user.id,
      walletAddress: address,
      ipHash: ipHash(request),
      ttlSeconds: 600,
    });

    return reply.send({
      nonce,
      message: walletLinkMessage({ address, nonce, origin: config.siteOrigin }),
      expiresInSeconds: 600,
    });
  });

  app.post('/api/wallet/link', async (request, reply) => {
    if (requireUser(request, reply)) return reply;

    const body = request.body || {};
    const { errors, value } = validateWalletLink(body);
    if (Object.keys(errors).length > 0) {
      return reply.code(400).send({ error: 'invalid_input', errors });
    }

    const nonceRow = await db.one(
      `select nonce, wallet_address
         from auth_nonces
        where nonce = $1
          and purpose = 'wallet_link'
          and user_id = $2
          and consumed_at is null
          and expires_at > now()`,
      [value.nonce, request.user.id]
    );

    if (!nonceRow || nonceRow.wallet_address !== value.address) {
      return reply.code(400).send({ error: 'wallet_expired', message: 'Request a new challenge.' });
    }

    const message = walletLinkMessage({
      address: value.address,
      nonce: value.nonce,
      origin: config.siteOrigin,
    });

    if (!verifyWalletSignature({ message, signature: value.signature, address: value.address })) {
      app.log.warn({ userId: request.user.id }, 'wallet signature rejected');
      return reply.code(400).send({ error: 'wallet_failed', message: 'Signature did not verify.' });
    }

    // Read the balance before writing, so a stored wallet always carries the
    // balance observed at link time.
    let balance = { baseUnits: 0n, amount: '0.00000000', decimals: config.solana.decimals };
    try {
      balance = await balanceReader(value.address);
    } catch (error) {
      app.log.warn({ err: error.message }, 'balance read failed during wallet link');
    }

    try {
      await db.transaction(async (tx) => {
        const consumed = await tx.one(
          `update auth_nonces
              set consumed_at = now()
            where nonce = $1 and consumed_at is null
            returning nonce`,
          [value.nonce]
        );
        if (!consumed) throw Object.assign(new Error('nonce already used'), { code: 'nonce_used' });

        await tx.query(
          `insert into user_wallets
             (user_id, address, is_primary, proof_nonce, proof_message, proof_signature, first_seen_balance_f106)
           values ($1, $2, true, $3, $4, $5, $6)`,
          [request.user.id, value.address, value.nonce, message, value.signature, balance.amount]
        );
      });
    } catch (error) {
      if (error.code === '23505') {
        return reply.code(409).send({ error: 'wallet_exists', message: 'That wallet is already linked.' });
      }
      if (error.code === 'nonce_used') {
        return reply.code(409).send({ error: 'wallet_expired', message: 'That challenge was already used.' });
      }
      throw error;
    }

    app.log.info({ userId: request.user.id }, 'wallet linked and verified');
    return reply.code(201).send({
      address: value.address,
      balance: balance.amount,
      decimals: balance.decimals,
    });
  });

  app.get('/api/wallet/balance', async (request, reply) => {
    if (requireUser(request, reply)) return reply;

    const wallet = await db.one(
      'select address from user_wallets where user_id = $1 and is_primary = true',
      [request.user.id]
    );
    if (!wallet) {
      return reply.code(404).send({ error: 'wallet_none', message: 'No wallet linked.' });
    }

    try {
      const balance = await balanceReader(wallet.address);
      return reply.send({ address: wallet.address, balance: balance.amount, decimals: balance.decimals });
    } catch (error) {
      app.log.warn({ err: error.message }, 'balance read failed');
      return reply.code(503).send({ error: 'rpc_unavailable', message: 'Balance unavailable right now.' });
    }
  });
}
