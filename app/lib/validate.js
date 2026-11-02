// Input validation. Every rule here is enforced again by a database CHECK
// constraint, so a bug in this file cannot put invalid data on disk.

const USERNAME = /^[A-Za-z0-9_.-]{3,32}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function normalizeText(value) {
  return String(value ?? '').trim();
}

export function validateRegistration({ username, email, password, confirmPassword, acceptTerms }) {
  const errors = {};

  // Usernames are stored lowercase (enforced by a database CHECK) so two
  // accounts cannot differ only by case and impersonate each other.
  const name = normalizeText(username).toLowerCase();
  if (!name) errors.username = 'Choose a username.';
  else if (!USERNAME.test(name)) {
    errors.username = '3-32 characters: letters, digits, dot, dash, underscore. Stored lowercase.';
  }

  const mail = normalizeText(email).toLowerCase();
  if (!mail) errors.email = 'Enter an email address.';
  else if (mail.length > 254 || !EMAIL.test(mail)) errors.email = 'That email address does not look valid.';

  const pass = String(password ?? '');
  if (pass.length < 12) errors.password = 'Use at least 12 characters.';
  else if (pass.length > 200) errors.password = 'That password is too long.';
  else if (!/[a-zA-Z]/.test(pass) || !/[0-9]/.test(pass)) {
    errors.password = 'Mix letters and numbers.';
  }

  if (pass !== String(confirmPassword ?? '')) errors.confirmPassword = 'Passwords do not match.';

  if (!acceptTerms) errors.acceptTerms = 'You must accept the archive rules.';

  return { errors, value: { username: name, email: mail, password: pass } };
}

export function validateLogin({ email, password }) {
  const errors = {};
  const mail = normalizeText(email).toLowerCase();
  if (!mail) errors.email = 'Enter your email address.';
  if (!String(password ?? '')) errors.password = 'Enter your password.';
  return { errors, value: { email: mail, password: String(password ?? '') } };
}

export function isSolanaAddress(value) {
  return BASE58.test(String(value ?? ''));
}

export function validateWalletLink({ address, signature, nonce }) {
  const errors = {};
  if (!isSolanaAddress(address)) errors.address = 'That is not a Solana address.';
  if (!String(signature ?? '').trim()) errors.signature = 'Wallet signature is missing.';
  if (!/^[a-f0-9]{32}$/.test(String(nonce ?? ''))) errors.nonce = 'Verification challenge is invalid.';
  return { errors, value: { address: normalizeText(address), signature: normalizeText(signature), nonce: normalizeText(nonce) } };
}

// Fixed message catalogue: user-facing copy is looked up by key, never taken
// from the query string, so nothing a visitor types is ever reflected back.
export const MESSAGES = {
  'verify-sent': 'ACCOUNT CREATED. CHECK YOUR EMAIL FOR THE VERIFICATION LINK.',
  'verify-required': 'VERIFY YOUR EMAIL BEFORE SIGNING IN.',
  'verify-failed': 'THAT VERIFICATION LINK IS INVALID OR EXPIRED.',
  'verified': 'EMAIL VERIFIED. YOU MAY SIGN IN.',
  'invalid-credentials': 'INVALID EMAIL OR PASSWORD.',
  'signed-out': 'SESSION CLOSED.',
  'login-required': 'ACCOUNT REQUIRED. SIGN IN TO CONTINUE.',
  'wallet-linked': 'WALLET LINKED AND VERIFIED ON-CHAIN.',
  'wallet-exists': 'THAT WALLET IS ALREADY LINKED TO AN ACCOUNT.',
  'wallet-failed': 'WALLET VERIFICATION FAILED. TRY AGAIN.',
  'wallet-expired': 'VERIFICATION CHALLENGE EXPIRED. REQUEST A NEW ONE.',
  'wallet-none': 'NO WALLET LINKED.',
  'password-mismatch': 'PASSWORDS DO NOT MATCH.',
  'form-invalid': 'CHECK THE HIGHLIGHTED FIELDS.',
  'username-taken': 'THAT USERNAME IS TAKEN.',
  'email-taken': 'THAT EMAIL IS ALREADY REGISTERED.',
  'rate-limited': 'TOO MANY ATTEMPTS. WAIT AND TRY AGAIN.',
  'file-created': 'FILE CREATED AS A DRAFT. PUBLISH IT WHEN THE BRIEFING IS READY.',
  'file-saved': 'FILE UPDATED.',
  'file-unknown': 'NO SUCH FILE.',
  'answer-saved': 'CHALLENGE ANSWER SEALED. THE PLAINTEXT IS NOT STORED ANYWHERE.',
  'answer-locked': 'THE ANSWER CANNOT CHANGE: SOMEONE HAS ALREADY SUBMITTED AGAINST IT.',
  'attachment-saved': 'ATTACHMENT STORED PRIVATELY.',
  'attachment-removed': 'ATTACHMENT REMOVED.',
  'admin-required': 'ARCHIVIST SIGN-IN REQUIRED.',
};

// ---------------------------------------------------------------------
// Admin input: files and challenges
// ---------------------------------------------------------------------

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'brutal'];
export const WINNER_METHODS = [
  'first_correct',
  'limited_winners',
  'multiple_correct',
  'admin_selected',
  'time_limited',
];

const SLUG = /^[a-z0-9-]{1,80}$/;

// FILE106 was minted at 106 units with the mint authority revoked, so 106 is not
// a budget that can be topped up — it is the entire supply, forever. A reward
// above it cannot be paid and a holding requirement above it cannot be met,
// which makes them impossible rather than merely large. Both are rejected here
// and by a check constraint, so no seed or script can reintroduce them.
export const TOTAL_SUPPLY_F106 = 106;

// F106 has 8 decimals; every amount is handed to Postgres as a numeric string so
// no float ever decides how much is owed.
function amount(raw, {
  fallback = null,
  allowZero = true,
  max = 1e12,
  maxMessage = 'That amount is implausibly large.',
} = {}) {
  const text = normalizeText(raw).replace(/,/g, '');
  if (text === '') return { value: fallback };
  if (!/^\d+(\.\d{1,8})?$/.test(text)) return { error: 'Use a plain number with up to 8 decimals.' };

  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return { error: 'Use a plain number with up to 8 decimals.' };
  if (parsed < 0 || (!allowZero && parsed === 0)) {
    return { error: allowZero ? 'Cannot be negative.' : 'Must be greater than zero.' };
  }
  if (parsed > max) return { error: maxMessage };

  return { value: parsed.toFixed(8) };
}

function timestamp(raw, label) {
  const text = normalizeText(raw);
  if (text === '') return { value: null };
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return { error: `${label} is not a valid date and time.` };
  return { value: parsed.toISOString() };
}

export function validateFileInput(body = {}) {
  const errors = {};

  const title = normalizeText(body.title);
  if (!title) errors.title = 'Give the file a title.';
  else if (title.length > 120) errors.title = 'Keep the title under 120 characters.';

  const teaser = normalizeText(body.teaser);
  if (!teaser) errors.teaser = 'Write the public teaser.';
  else if (teaser.length > 280) errors.teaser = 'Keep the teaser under 280 characters.';

  const briefing = normalizeText(body.briefing);
  if (briefing.length > 8000) errors.briefing = 'Keep the briefing under 8000 characters.';

  const numberRaw = normalizeText(body.fileNumber);
  const number = Number.parseInt(numberRaw, 10);
  if (!/^\d+$/.test(numberRaw) || !Number.isInteger(number) || number < 1 || number > 100000) {
    errors.fileNumber = 'Use a whole number between 1 and 100000.';
  }

  const slugInput = normalizeText(body.slug).toLowerCase();
  const slug = slugInput || (Number.isInteger(number) ? `file-${number}` : '');
  if (!SLUG.test(slug)) errors.slug = 'Lowercase letters, digits and dashes only.';

  const difficulty = normalizeText(body.difficulty) || 'medium';
  if (!DIFFICULTIES.includes(difficulty)) errors.difficulty = 'Unknown difficulty.';

  const winnerMethod = normalizeText(body.winnerMethod) || 'first_correct';
  if (!WINNER_METHODS.includes(winnerMethod)) errors.winnerMethod = 'Unknown winner method.';

  const reward = amount(body.reward, {
    fallback: null,
    allowZero: false,
    max: TOTAL_SUPPLY_F106,
    maxMessage: `The reward cannot exceed the total supply, ${TOTAL_SUPPLY_F106} F106.`,
  });
  if (reward.error) errors.reward = reward.error;
  else if (reward.value === null) errors.reward = 'Enter the reward amount in F106.';

  const holding = amount(body.minHolding, {
    fallback: '1.00000000',
    max: TOTAL_SUPPLY_F106,
    maxMessage: `The holding requirement cannot exceed the total supply, ${TOTAL_SUPPLY_F106} F106.`,
  });
  if (holding.error) errors.minHolding = holding.error;

  const maxWinnersRaw = normalizeText(body.maxWinners);
  let maxWinners = null;
  if (maxWinnersRaw !== '') {
    const parsed = Number.parseInt(maxWinnersRaw, 10);
    if (!/^\d+$/.test(maxWinnersRaw) || parsed < 1 || parsed > 1000) {
      errors.maxWinners = 'Use a whole number between 1 and 1000, or leave it blank.';
    } else {
      maxWinners = parsed;
    }
  }

  const opens = timestamp(body.opensAt, 'Opening time');
  if (opens.error) errors.opensAt = opens.error;
  const closes = timestamp(body.closesAt, 'Closing time');
  if (closes.error) errors.closesAt = closes.error;

  if (opens.value && closes.value && new Date(closes.value) <= new Date(opens.value)) {
    errors.closesAt = 'The closing time must be after the opening time.';
  }

  return {
    errors,
    value: {
      fileNumber: number,
      slug,
      title,
      teaser,
      briefing,
      difficulty,
      winnerMethod,
      reward: reward.value,
      minHolding: holding.value,
      maxWinners,
      opensAt: opens.value,
      closesAt: closes.value,
    },
  };
}

export const FILE_STATUSES = ['draft', 'open', 'locked', 'closed', 'completed', 'archived'];

export function validateChallengeInput(body = {}) {
  const errors = {};

  const prompt = normalizeText(body.prompt);
  if (!prompt) errors.prompt = 'Write the prompt the participant answers.';
  else if (prompt.length > 4000) errors.prompt = 'Keep the prompt under 4000 characters.';

  const answerFormat = normalizeText(body.answerFormat) || 'text';
  if (!['text', 'numeric'].includes(answerFormat)) errors.answerFormat = 'Unknown answer format.';

  const answer = normalizeText(body.answer);
  if (!answer) errors.answer = 'The answer is required: it is hashed, never stored.';
  else if (answer.length < 2) errors.answer = 'Use at least 2 characters.';
  else if (answer.length > 500) errors.answer = 'Keep the answer under 500 characters.';
  else if (answerFormat === 'numeric' && !/^-?\d+(\.\d+)?$/.test(answer)) {
    errors.answer = 'A numeric answer must contain only digits, a dash and a decimal point.';
  }

  const maxAttempts = Number.parseInt(normalizeText(body.maxAttempts) || '1', 10);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    errors.maxAttempts = 'Allow between 1 and 10 attempts.';
  }

  return {
    errors,
    value: {
      prompt,
      answer,
      answerFormat,
      caseSensitive: Boolean(body.caseSensitive),
      maxAttempts,
    },
  };
}

export function messageText(key) {
  return Object.prototype.hasOwnProperty.call(MESSAGES, key) ? MESSAGES[key] : '';
}
