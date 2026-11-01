// Wallet connection for THE FILE106 ARCHIVE.
//
// The browser only ever produces a public address and a signature. It cannot
// assert a balance: the server asks Solana itself. No private key, seed phrase
// or transaction approval is requested here — signing a message moves nothing.

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function toBase58(bytes) {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);

  let out = '';
  while (value > 0n) {
    out = BASE58_ALPHABET[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out || '1';
}

function provider() {
  return window.phantom?.solana ?? window.solana ?? null;
}

function initWalletPanel() {
  const panel = document.getElementById('wallet-panel');
  if (!panel) return;

  const csrf = panel.dataset.csrf || '';
  const statusEl = panel.querySelector('[data-wallet-status]');
  const balanceEl = panel.querySelector('.balance-value');

  const say = (message, kind = '') => {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.dataset.kind = kind;
  };

  const call = async (url, options = {}) => {
    const response = await fetch(url, {
      ...options,
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        ...(options.headers || {}),
      },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || `Request failed (${response.status})`);
    }
    return payload;
  };

  async function connect() {
    const wallet = provider();

    if (!wallet) {
      say('NO SOLANA WALLET DETECTED. INSTALL A WALLET SUCH AS PHANTOM, THEN RELOAD.', 'error');
      return;
    }

    try {
      say('AWAITING WALLET APPROVAL...');

      const connection = await wallet.connect();
      const address = connection.publicKey.toString();

      say('REQUESTING A SIGNING CHALLENGE...');
      const challenge = await call('/api/wallet/challenge', {
        method: 'POST',
        body: JSON.stringify({ address }),
      });

      say('SIGN THE MESSAGE IN YOUR WALLET. IT DOES NOT MOVE FUNDS.');
      const encoded = new TextEncoder().encode(challenge.message);
      const signed = await wallet.signMessage(encoded, 'utf8');
      const signature = toBase58(signed.signature);

      say('VERIFYING SIGNATURE AND READING BALANCE...');
      await call('/api/wallet/link', {
        method: 'POST',
        body: JSON.stringify({ address, signature, nonce: challenge.nonce }),
      });

      say('WALLET VERIFIED. RELOADING...', 'ok');
      window.location.assign('/dashboard?notice=wallet-linked');
    } catch (error) {
      const message = String(error?.message || 'Wallet verification failed.');
      say(message.toUpperCase(), 'error');
    }
  }

  async function refreshBalance() {
    try {
      say('READING CHAIN...');
      const data = await call('/api/wallet/balance', { method: 'GET' });
      if (balanceEl) balanceEl.textContent = data.balance;
      say('BALANCE UPDATED.', 'ok');
    } catch (error) {
      say(String(error.message).toUpperCase(), 'error');
    }
  }

  panel.addEventListener('click', (event) => {
    const button = event.target.closest('[data-wallet-action]');
    if (!button) return;

    const action = button.dataset.walletAction;
    if (action === 'connect') connect();
    if (action === 'refresh') refreshBalance();
  });
}

initWalletPanel();
