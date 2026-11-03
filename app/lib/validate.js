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
  // Mystery layer
  'file-unlocked': 'ACCESS CODE ACCEPTED. THE SEALED SECTION IS NOW VISIBLE.',
  'code-invalid': 'ACCESS CODE REFUSED. CHECK THE RECOVERED FRAGMENT.',
  'file-sealed': 'THIS FILE IS SEALED. FIND THE CODE OR THE PRECEDING RECORD FIRST.',
  'prerequisite-missing': 'THE PREVIOUS FILE HAS NOT BEEN RECOVERED.',
  'clue-required': 'A RECOVERED CLUE IS REQUIRED BEFORE THIS FILE OPENS.',
  'clue-found': 'SIGNAL LOGGED. A NEW FRAGMENT IS IN YOUR INVESTIGATION LOG.',
  'clue-locked': 'SIGNAL LOCKED. DECODE THE EARLIER FRAGMENT FIRST.',
  'clue-unknown': 'NO SUCH SIGNAL EXISTS IN THIS ARCHIVE.',
  'clue-disabled': 'THIS SIGNAL HAS GONE DARK.',
  'answer-correct': 'ANSWER ACCEPTED. THE SUBMISSION IS QUEUED FOR ARCHIVIST REVIEW.',
  'answer-incorrect': 'ANSWER REFUSED. THE ATTEMPT WAS RECORDED.',
  'answer-required': 'ENTER AN ANSWER.',
  'attempts-exhausted': 'NO ATTEMPTS REMAIN FOR THIS FILE.',
  'already-submitted': 'A CORRECT SUBMISSION IS ALREADY ON FILE. WAIT FOR REVIEW.',
  'submission-holding': 'HOLDING REQUIREMENT NOT MET AT SUBMISSION TIME.',
  'wallet-required': 'LINK A WALLET BEFORE SUBMITTING.',
  'chapter-locked': 'THIS CHAPTER IS ENCRYPTED. RECOVER MORE FRAGMENTS.',
  'chapter-unknown': 'NO SUCH CHAPTER.',
  'chapter-saved': 'CHAPTER SAVED.',
  'chapter-created': 'CHAPTER CREATED AS A DRAFT.',
  'clue-saved': 'CLUE SAVED.',
  'clue-created': 'CLUE CREATED. IT IS HIDDEN UNTIL SOMEONE FINDS IT.',
  'submission-approved': 'SUBMISSION APPROVED. A REWARD RECORD IS AWAITING MANUAL PAYMENT.',
  'submission-rejected': 'SUBMISSION REJECTED.',
  'submission-unknown': 'NO SUCH SUBMISSION.',
  'reward-unknown': 'NO SUCH REWARD.',
  'reward-confirmed': 'TRANSACTION VERIFIED AND REWARD CONFIRMED.',
  'reward-pending': 'TRANSACTION NOT YET CONFIRMED ON-CHAIN. THE REWARD REMAINS OPEN.',
  'reward-failed': 'TRANSACTION VERIFICATION FAILED. THE REWARD REMAINS OPEN.',
  'reward-already-confirmed': 'THIS REWARD IS ALREADY CONFIRMED.',
  'transaction-duplicate': 'THAT SIGNATURE IS ALREADY RECORDED.',
  'transaction-invalid': 'THAT IS NOT A VALID SOLANA SIGNATURE.',
  'verifier-unavailable': 'ON-CHAIN VERIFICATION IS UNAVAILABLE. NOTHING WAS MARKED PAID.',
  'holding-failed': 'THE WALLET NO LONGER HOLDS THE REQUIRED F106. APPROVAL REFUSED.',
  'balance-unavailable': 'THE HOLDING COULD NOT BE READ. APPROVAL REFUSED.',
  'winner-limit': 'THIS FILE HAS REACHED ITS WINNER LIMIT.',
  'winner-duplicate': 'THIS WALLET HAS ALREADY WON THIS FILE.',
  'submission-not-pending': 'THAT SUBMISSION IS NOT AWAITING REVIEW.',
  'reward-recorded': 'REWARD RECORD CREATED.',
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

  const classification = normalizeText(body.classification) || 'UNCLASSIFIED';
  if (classification.length > 40) errors.classification = 'Keep the classification under 40 characters.';

  const loreBody = normalizeText(body.loreBody);
  if (loreBody.length > 40000) errors.loreBody = 'Keep the recovered document under 40000 characters.';

  const chapterRaw = normalizeText(body.chapterNo);
  let chapterNo = null;
  if (chapterRaw !== '') {
    const parsed = Number.parseInt(chapterRaw, 10);
    if (!/^\d+$/.test(chapterRaw) || parsed < 1 || parsed > 99) {
      errors.chapterNo = 'Use a whole number between 1 and 99, or leave it blank.';
    } else {
      chapterNo = parsed;
    }
  }

  const mysteryOrderRaw = normalizeText(body.mysteryOrder);
  let mysteryOrder = null;
  if (mysteryOrderRaw !== '') {
    const parsed = Number.parseInt(mysteryOrderRaw, 10);
    if (!/^\d+$/.test(mysteryOrderRaw) || parsed < 1 || parsed > 999) {
      errors.mysteryOrder = 'Use a whole number between 1 and 999, or leave it blank.';
    } else {
      mysteryOrder = parsed;
    }
  }

  const unlockHint = normalizeText(body.unlockHint);
  if (unlockHint.length > 800) errors.unlockHint = 'Keep the hint under 800 characters.';

  const unlockCode = normalizeText(body.unlockCode);
  if (unlockCode !== '' && (unlockCode.length < 2 || unlockCode.length > 200)) {
    errors.unlockCode = 'Use between 2 and 200 characters, or leave it blank to keep the current code.';
  }

  const requiredFileRaw = normalizeText(body.requiredFileNumber);
  let requiredFileNumber = null;
  if (requiredFileRaw !== '') {
    const parsed = Number.parseInt(requiredFileRaw, 10);
    if (!/^\d+$/.test(requiredFileRaw) || parsed < 1 || parsed > 100000) {
      errors.requiredFileNumber = 'Use a whole file number, or leave it blank.';
    } else if (Number.isInteger(number) && parsed === number) {
      errors.requiredFileNumber = 'A file cannot require itself.';
    } else {
      requiredFileNumber = parsed;
    }
  }

  const clueRaw = normalizeText(body.unlockRequiresClue);
  let unlockRequiresClue = null;
  if (clueRaw !== '') {
    const parsed = Number.parseInt(clueRaw, 10);
    if (!/^\d+$/.test(clueRaw) || parsed < 1 || parsed > 999) {
      errors.unlockRequiresClue = 'Use a clue number such as 3, or leave it blank.';
    } else {
      unlockRequiresClue = parsed;
    }
  }

  const isMystery = Boolean(body.isMystery) || chapterNo !== null || loreBody !== '' || unlockCode !== '';

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
      classification,
      loreBody,
      chapterNo,
      mysteryOrder,
      unlockHint,
      unlockCode,
      removeUnlockCode: Boolean(body.removeUnlockCode),
      requiredFileNumber,
      unlockRequiresClue,
      isMystery,
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

// ---------------------------------------------------------------------
// Mystery layer: chapters, clues, unlock codes, submissions, payouts
// ---------------------------------------------------------------------

export const CHAPTER_STATUSES = ['draft', 'published', 'archived'];

function optionalNumber(raw, { label, min = 1, max = 100000 }) {
  const text = normalizeText(raw);
  if (text === '') return { value: null };
  const parsed = Number.parseInt(text, 10);
  if (!/^\d+$/.test(text) || parsed < min || parsed > max) {
    return { error: `Use a whole number between ${min} and ${max}, or leave it blank.` };
  }
  return { value: parsed };
}

export function validateChapterInput(body = {}) {
  const errors = {};

  const chapterNoRaw = normalizeText(body.chapterNo);
  const chapterNo = Number.parseInt(chapterNoRaw, 10);
  if (!/^\d+$/.test(chapterNoRaw) || chapterNo < 1 || chapterNo > 99) {
    errors.chapterNo = 'Use a whole number between 1 and 99.';
  }

  const slugInput = normalizeText(body.slug).toLowerCase();
  const slug = slugInput || (Number.isInteger(chapterNo) ? `chapter-${chapterNo}` : '');
  if (!SLUG.test(slug)) errors.slug = 'Lowercase letters, digits and dashes only.';

  const eyebrow = normalizeText(body.eyebrow) || (Number.isInteger(chapterNo) ? `CHAPTER ${String(chapterNo).padStart(2, '0')}` : 'CHAPTER');
  if (eyebrow.length > 60) errors.eyebrow = 'Keep the eyebrow under 60 characters.';

  const title = normalizeText(body.title);
  if (!title) errors.title = 'Give the chapter a title.';
  else if (title.length > 120) errors.title = 'Keep the title under 120 characters.';

  const summary = normalizeText(body.summary);
  if (summary.length > 500) errors.summary = 'Keep the summary under 500 characters.';

  const chapterBody = normalizeText(body.body);
  if (!chapterBody) errors.body = 'Write the chapter text.';
  else if (chapterBody.length > 40000) errors.body = 'Keep the chapter under 40000 characters.';

  const requiredCluesRaw = normalizeText(body.requiredClueCount || '0');
  const requiredClueCount = Number.parseInt(requiredCluesRaw, 10);
  if (!/^\d+$/.test(requiredCluesRaw) || requiredClueCount < 0 || requiredClueCount > 99) {
    errors.requiredClueCount = 'Use a whole number between 0 and 99.';
  }

  const requiredFile = optionalNumber(body.requiredFileNumber, { label: 'Required file' });
  if (requiredFile.error) errors.requiredFileNumber = requiredFile.error;

  const status = normalizeText(body.status) || 'draft';
  if (!CHAPTER_STATUSES.includes(status)) errors.status = 'Unknown chapter status.';

  return {
    errors,
    value: {
      chapterNo,
      slug,
      eyebrow,
      title,
      summary,
      body: chapterBody,
      requiredClueCount,
      requiredFileNumber: requiredFile.value,
      status,
    },
  };
}

export function validateClueInput(body = {}) {
  const errors = {};

  const clueNoRaw = normalizeText(body.clueNo);
  const clueNo = Number.parseInt(clueNoRaw, 10);
  if (!/^\d+$/.test(clueNoRaw) || clueNo < 1 || clueNo > 999) {
    errors.clueNo = 'Use a whole number between 1 and 999.';
  }

  const slugInput = normalizeText(body.slug).toLowerCase();
  const slug = slugInput || (Number.isInteger(clueNo) ? `clue-${String(clueNo).padStart(3, '0')}` : '');
  if (!SLUG.test(slug)) errors.slug = 'Lowercase letters, digits and dashes only.';

  const title = normalizeText(body.title);
  if (!title) errors.title = 'Give the clue a title.';
  else if (title.length > 120) errors.title = 'Keep the title under 120 characters.';

  const clueBody = normalizeText(body.body);
  if (!clueBody) errors.body = 'Write what the clue reveals.';
  else if (clueBody.length > 12000) errors.body = 'Keep the clue under 12000 characters.';

  const hint = normalizeText(body.hint);
  if (hint.length > 800) errors.hint = 'Keep the hint under 800 characters.';

  const location = normalizeText(body.location);
  if (location.length > 200) errors.location = 'Keep the location under 200 characters.';

  const chapter = optionalNumber(body.chapterNo, { label: 'Chapter', max: 99 });
  if (chapter.error) errors.chapterNo = chapter.error;

  const file = optionalNumber(body.fileNumber, { label: 'File number', max: 100000 });
  if (file.error) errors.fileNumber = file.error;

  const requires = optionalNumber(body.requiresClueNo, { label: 'Required clue', max: 999 });
  if (requires.error) errors.requiresClueNo = requires.error;
  else if (requires.value !== null && requires.value === clueNo) {
    errors.requiresClueNo = 'A clue cannot require itself.';
  }

  return {
    errors,
    value: {
      clueNo,
      slug,
      title,
      body: clueBody,
      hint,
      location,
      chapterNo: chapter.value,
      fileNumber: file.value,
      requiresClueNo: requires.value,
      isEnabled: body.isEnabled === undefined ? true : Boolean(body.isEnabled),
    },
  };
}

export function validateUnlockCode(value) {
  const code = normalizeText(value);
  if (!code) return { error: 'Enter the recovered access code.' };
  if (code.length < 2 || code.length > 200) return { error: 'That code is not the right shape.' };
  return { value: code };
}

export function validateAnswerSubmission(value) {
  const answer = normalizeText(value);
  if (!answer) return { error: 'Enter an answer.' };
  if (answer.length > 500) return { error: 'Keep the answer under 500 characters.' };
  return { value: answer };
}

export const TRANSACTION_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

export function validateTransactionSignature(value) {
  const signature = normalizeText(value);
  if (!TRANSACTION_SIGNATURE.test(signature)) {
    return { error: 'That is not a valid Solana transaction signature.' };
  }
  return { value: signature };
}

export function validateAdminNote(value) {
  const note = normalizeText(value);
  if (note.length > 2000) return { error: 'Keep the note under 2000 characters.' };
  return { value: note };
}
