// Configuration is read once, validated once, and then passed down explicitly.
// Nothing in the app reads process.env directly, so every dependency a route
// needs is visible in its signature and injectable in tests.

import { randomBytes } from 'node:crypto';
import { config as loadDotenv } from 'dotenv';

loadDotenv();

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return TRUTHY.has(String(value).trim().toLowerCase());
}

function int(value, fallback, { min, max } = {}) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (min !== undefined && parsed < min) return min;
  if (max !== undefined && parsed > max) return max;
  return parsed;
}

function text(value, fallback = '') {
  const trimmed = String(value ?? '').trim();
  return trimmed === '' ? fallback : trimmed;
}

const warnings = [];

// In development a missing secret is generated per boot so the app still runs.
// In production it is a hard failure: rotating SESSION_SECRET silently would
// log everyone out, and a random ANSWER_ENC_KEY would make sealed answers
// permanently unreadable.
function secret(name, env, { hex = false } = {}) {
  const raw = text(env[name]);
  const length = hex ? 64 : 32;

  if (raw.length >= length) {
    if (hex && !/^[0-9a-fA-F]+$/.test(raw)) {
      throw new Error(`${name} must be hexadecimal`);
    }
    return raw;
  }

  if (env.NODE_ENV === 'production') {
    throw new Error(
      `${name} is missing or too short (need ${length} characters). ` +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }

  const generated = randomBytes(32).toString('hex');
  warnings.push(`${name} was not set; generated an ephemeral value for this process only`);
  return generated;
}

export function loadConfig(overrides = {}) {
  const env = { ...process.env, ...overrides };
  const isProduction = text(env.NODE_ENV, 'development') === 'production';

  const mintAddress = text(env.F106_MINT_ADDRESS);
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mintAddress)) {
    throw new Error('F106_MINT_ADDRESS must be a valid Solana mint address');
  }

  const smtpUrl = text(env.SMTP_URL);

  const config = {
    env: text(env.NODE_ENV, 'development'),
    isProduction,
    host: text(env.HOST, '127.0.0.1'),
    port: int(env.PORT, 3000, { min: 1, max: 65535 }),

    siteOrigin: text(env.SITE_ORIGIN, 'http://localhost:3000').replace(/\/+$/, ''),

    databaseUrl: text(env.DATABASE_URL, 'postgres://file106:file106@127.0.0.1:5432/file106'),

    sessionSecret: secret('SESSION_SECRET', env),
    answerEncKey: secret('ANSWER_ENC_KEY', env, { hex: true }),
    sessionTtlHours: int(env.SESSION_TTL_HOURS, 168, { min: 1, max: 24 * 90 }),
    anonymousSessionTtlHours: 6,
    // Admin sessions are deliberately shorter than participant sessions: the
    // panel can seal answers and change what the public sees, so a stolen
    // cookie has hours rather than a week to be useful.
    adminSessionTtlHours: int(env.ADMIN_SESSION_TTL_HOURS, 12, { min: 1, max: 72 }),

    // Uploaded exhibits live outside the served static tree and are reachable
    // only through an admin-authenticated route. The directory is resolved
    // against the process working directory so a container volume can back it.
    uploads: {
      dir: text(env.ARCHIVE_UPLOAD_DIR, 'var/uploads'),
      maxBytes: int(env.ARCHIVE_UPLOAD_MAX_BYTES, 8 * 1024 * 1024, { min: 1024, max: 32 * 1024 * 1024 }),
      allowedMime: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain'],
    },

    solana: {
      rpcUrl: text(env.ARCHIVE_RPC_URL, 'https://api.mainnet-beta.solana.com'),
      commitment: text(env.ARCHIVE_COMMITMENT, 'confirmed'),
      cluster: text(env.ARCHIVE_CLUSTER, 'mainnet-beta'),
      mintAddress,
      decimals: int(env.F106_DECIMALS, 8, { min: 0, max: 18 }),
    },

    mail: {
      smtpUrl,
      from: text(env.MAIL_FROM, 'archive@file106.local'),
      // With no SMTP transport the verification link is written to the server
      // log and, outside production only, echoed on the confirmation page so
      // the flow can be completed locally.
      exposeLinks: !smtpUrl && !isProduction,
    },

    features: {
      xOauth: bool(env.X_OAUTH_ENABLED),
      telegram: bool(env.TELEGRAM_ENABLED),
      automaticPayouts: bool(env.ALLOW_AUTOMATIC_PAYOUTS),
    },

    trustPageRoot: text(env.TRUST_PAGE_ROOT, 'site'),

    // The local preview panel embeds the app in a frame, which frame-ancestors
    // 'none' refuses by design. The exception is opt-in and is ignored outright
    // in production, so the deployed archive keeps both headers.
    allowPreviewFraming: bool(env.ALLOW_PREVIEW_FRAMING) && !isProduction,

    warnings,
  };

  if (config.features.automaticPayouts) {
    throw new Error(
      'ALLOW_AUTOMATIC_PAYOUTS must stay false: the archive never holds a treasury key ' +
        'and every reward is paid manually by an administrator.'
    );
  }

  if (!config.features.xOauth && !warnings.some((w) => w.startsWith('X task'))) {
    warnings.push('X task verification is in manual review mode (X_OAUTH_ENABLED is false)');
  }

  return config;
}

export { bool, int, text };
