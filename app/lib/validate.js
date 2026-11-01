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
};

export function messageText(key) {
  return Object.prototype.hasOwnProperty.call(MESSAGES, key) ? MESSAGES[key] : '';
}
