// Public archive: the file list, one file page, access-code unlocking and the
// answer terminal.
//
// Rules that hold on every path here:
//
//   * Drafts and archived files are invisible, so a URL cannot leak something
//     an archivist has not published.
//   * No query in this file selects `challenges.answer_hash` or
//     `files.unlock_code_hash`. A hash is fetched only inside the two POST
//     handlers that compare it, and it never reaches a view or a redirect.
//   * A file's sealed section is rendered only after the server has decided the
//     visitor is allowed to see it. The browser is never the thing that hides
//     an answer.

import { challengeAnswerMatches } from '../lib/answers.js';
import { csrfToken } from '../lib/csrf.js';
import { answerDigest, sealAnswer, verifySecret } from '../../scripts/archive/secret-hash.mjs';
import { loadUserContext, recordFileUnlock } from '../lib/investigation.js';
import { fileLabel, fileLockState } from '../lib/mystery.js';
import { ipHash } from '../lib/ip.js';
import { parseUnits } from '../lib/solana.js';
import {
  messageText,
  validateAnswerSubmission,
  validateUnlockCode,
} from '../lib/validate.js';
import { redirect, sendPage } from '../lib/reply.js';
import { archiveFilePage, archiveListPage } from '../views/archive.js';

// Anything not listed here is not public. 'draft' and 'archived' are absent on
// purpose, so the default for a new status is invisible rather than exposed.
const PUBLIC_STATUSES = ['open', 'locked', 'closed', 'completed'];

const GROUPS = [
  { key: 'open', label: 'OPEN', note: 'Accepting answers', statuses: ['open'] },
  { key: 'locked', label: 'LOCKED', note: 'An answer is under review', statuses: ['locked'] },
  { key: 'closed', label: 'CLOSED', note: 'The window has ended', statuses: ['closed'] },
  { key: 'completed', label: 'COMPLETED', note: 'Solved and rewarded', statuses: ['completed'] },
];

const SLUG = /^[a-z0-9-]{1,80}$/;

function summarise(row, context) {
  const lock = fileLockState({
    file: row,
    discoveredClues: context.discoveredClues,
    unlockedNumbers: context.unlockedNumbers,
  });

  return {
    number: row.file_number,
    slug: row.slug,
    title: row.title,
    teaser: row.teaser,
    difficulty: row.difficulty,
    status: row.status,
    reward: row.reward,
    classification: row.classification || '',
    isMystery: Boolean(row.is_mystery),
    locked: Boolean(row.is_mystery) && lock.locked,
    lockReason: lock.reason,
  };
}

// The four columns that decide access. `unlock_code_hash` itself is never
// selected; the boolean is the only thing a page needs to know.
const FILE_COLUMNS = `file_number, slug, title, teaser, briefing, difficulty, status,
  reward_amount_f106::text as reward,
  min_holding_f106::text  as min_holding,
  winner_method, max_winners, opens_at, closes_at,
  classification, lore_body, chapter_no, mystery_order,
  required_file_number, unlock_requires_clue, unlock_hint,
  is_mystery, (unlock_code_hash is not null) as has_unlock_code`;

function unlockMethodFor(file) {
  if (file.required_file_number) return 'prerequisite';
  if (file.unlock_requires_clue) return 'clue';
  return 'open';
}

async function loadChallenge(db, fileId) {
  return db.one(
    `select id, position, prompt, answer_format, max_attempts
       from challenges
      where file_id = $1
      order by position asc
      limit 1`,
    [fileId]
  );
}

async function submissionState(db, userId, challenge) {
  if (!userId || !challenge) return { attempts: 0, remaining: 0, hasCorrect: false };

  const row = await db.one(
    `select
       count(*)::int as attempts,
       count(*) filter (where status in ('correct','approved','rewarded'))::int as correct
     from submissions
     where user_id = $1 and challenge_id = $2`,
    [userId, challenge.id]
  );

  const attempts = Number(row?.attempts ?? 0);
  return {
    attempts,
    remaining: Math.max(0, Number(challenge.max_attempts) - attempts),
    hasCorrect: Number(row?.correct ?? 0) > 0,
  };
}

export async function archiveRoutes(app, { db, config, balanceReader }) {
  app.get('/archive', async (request, reply) => {
    const context = await loadUserContext(db, request.user?.id);

    const rows = await db.many(
      `select file_number, slug, title, teaser, difficulty, status,
              reward_amount_f106::text as reward, classification,
              is_mystery, required_file_number, unlock_requires_clue,
              (unlock_code_hash is not null) as has_unlock_code
         from files
        where is_enabled and status = any($1::text[])
        order by file_number asc`,
      [PUBLIC_STATUSES]
    );

    // Counted separately so the empty state can say "nothing published" rather
    // than "nothing exists" — the difference matters to whoever just installed
    // the archive and wonders whether their work was saved.
    const total = await db.value('select count(*)::int as v from files');

    const groups = GROUPS.map((group) => ({
      ...group,
      files: rows
        .filter((row) => group.statuses.includes(row.status))
        .map((row) => summarise(row, context)),
    }));

    return sendPage(
      reply,
      archiveListPage({
        session: request.session,
        groups,
        total,
        signedIn: Boolean(request.user),
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  app.get('/archive/:slug', async (request, reply) => {
    const slug = String(request.params.slug ?? '');
    // Rejected before the query: an unshaped slug cannot be a record, and this
    // keeps the index lookup to one shape.
    if (!SLUG.test(slug)) return reply.callNotFound();

    const file = await db.one(
      `select ${FILE_COLUMNS}
         from files
        where slug = $1 and is_enabled and status = any($2::text[])`,
      [slug, PUBLIC_STATUSES]
    );

    if (!file) return reply.callNotFound();

    const user = request.user;
    const context = await loadUserContext(db, user?.id);
    const lock = fileLockState({
      file,
      discoveredClues: context.discoveredClues,
      unlockedNumbers: context.unlockedNumbers,
    });

    // Opening a file that needs no code is itself a discovery. Failure to record
    // it must not deny a page the visitor is allowed to read, so this is a write
    // after the decision rather than part of it.
    if (user && !lock.locked && !context.unlockedNumbers.has(Number(file.file_number))) {
      await recordFileUnlock(db, {
        userId: user.id,
        file,
        method: unlockMethodFor(file),
      });
      context.unlockedNumbers.add(Number(file.file_number));
    }

    const challenge = await loadChallenge(db, file.id);
    const state = await submissionState(db, user?.id, challenge);

    const view = {
      number: file.file_number,
      slug: file.slug,
      title: file.title,
      teaser: file.teaser,
      briefing: file.briefing ?? '',
      difficulty: file.difficulty,
      status: file.status,
      reward: file.reward,
      minHolding: file.min_holding,
      winnerMethod: file.winner_method,
      maxWinners: file.max_winners,
      opensAt: file.opens_at,
      closesAt: file.closes_at,
      classification: file.classification || '',
      loreBody: file.lore_body ?? '',
      chapterNo: file.chapter_no,
      mysteryOrder: file.mystery_order,
      unlockHint: file.unlock_hint ?? '',
      requiredFileNumber: file.required_file_number,
      unlockRequiresClue: file.unlock_requires_clue,
      hasUnlockCode: Boolean(file.has_unlock_code),
      isMystery: Boolean(file.is_mystery),
      locked: Boolean(file.is_mystery) && lock.locked,
      lockReason: lock.reason,
      requiredFile: lock.requiredFile ?? null,
      requiredClue: lock.requiredClue ?? null,
    };

    const eligibility = {
      signedIn: Boolean(user),
      wallet: '',
      balance: '',
      balanceError: '',
      satisfied: false,
    };

    if (user) {
      const wallet = await db.one(
        'select address from user_wallets where user_id = $1 and is_primary = true',
        [user.id]
      );

      if (wallet) {
        eligibility.wallet = wallet.address;
        try {
          const balance = await balanceReader(wallet.address);
          eligibility.balance = balance.amount;
          // The holding rule compares base units, so a 1.00000001 balance
          // satisfies a 1 F106 file without any float rounding in between.
          eligibility.satisfied =
            balance.baseUnits >= parseUnits(file.min_holding, config.solana.decimals);
        } catch (error) {
          request.log.warn({ err: error.message }, 'balance read failed on file page');
          eligibility.balanceError = 'unavailable';
        }
      }
    }

    return sendPage(
      reply,
      archiveFilePage({
        session: request.session,
        file: view,
        eligibility,
        challenge: view.locked ? null : challenge,
        submission: state,
        csrf: csrfToken(request.session),
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  // -------------------------------------------------------------------
  // Access code
  // -------------------------------------------------------------------
  app.post(
    '/archive/:slug/unlock',
    { config: { rateLimit: { max: 12, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      const slug = String(request.params.slug ?? '');
      if (!SLUG.test(slug)) return reply.callNotFound();

      if (!request.user) return redirect(reply, '/login?notice=login-required');

      const file = await db.one(
        `select id, file_number, slug, title, required_file_number,
                unlock_requires_clue, (unlock_code_hash is not null) as has_unlock_code
           from files
          where slug = $1 and is_enabled and status = any($2::text[])`,
        [slug, PUBLIC_STATUSES]
      );

      if (!file) return reply.callNotFound();

      const context = await loadUserContext(db, request.user.id);

      if (context.unlockedNumbers.has(Number(file.file_number))) {
        return redirect(reply, `/archive/${slug}?notice=file-unlocked`);
      }

      if (file.required_file_number && !context.unlockedNumbers.has(Number(file.required_file_number))) {
        return redirect(reply, `/archive/${slug}?notice=prerequisite-missing`);
      }

      if (file.unlock_requires_clue && !context.discoveredClues.has(Number(file.unlock_requires_clue))) {
        return redirect(reply, `/archive/${slug}?notice=clue-required`);
      }

      if (!file.has_unlock_code) {
        return redirect(reply, `/archive/${slug}?notice=file-sealed`);
      }

      // The hash is fetched only now, in the handler that compares it.
      const secret = await db.one('select unlock_code_hash from files where id = $1', [file.id]);
      const parsed = validateUnlockCode(request.body?.code);

      if (parsed.error) return redirect(reply, `/archive/${slug}?notice=code-invalid`);

      // Stored with the same normalisation as the admin input, so casing and
      // surrounding whitespace cannot decide whether a recovered code works.
      if (!verifySecret(parsed.value.normalize('NFKC'), secret?.unlock_code_hash ?? '')) {
        request.log.warn(
          { fileId: file.id, userId: request.user.id, ip: ipHash(request) },
          'file unlock code refused'
        );
        return redirect(reply, `/archive/${slug}?notice=code-invalid`);
      }

      await recordFileUnlock(db, {
        userId: request.user.id,
        file,
        method: 'code',
      });

      return redirect(reply, `/archive/${slug}?notice=file-unlocked`);
    }
  );

  // -------------------------------------------------------------------
  // Answer terminal
  // -------------------------------------------------------------------
  app.post(
    '/archive/:slug/submit',
    { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      const slug = String(request.params.slug ?? '');
      if (!SLUG.test(slug)) return reply.callNotFound();

      if (!request.user) return redirect(reply, '/login?notice=login-required');

      const file = await db.one(
        `select id, file_number, slug, title, status, reward_amount_f106::text as reward,
                min_holding_f106::text as min_holding, max_winners, closes_at,
                is_mystery, required_file_number, unlock_requires_clue,
                (unlock_code_hash is not null) as has_unlock_code
           from files
          where slug = $1 and is_enabled and status = any($2::text[])`,
        [slug, PUBLIC_STATUSES]
      );

      if (!file) return reply.callNotFound();

      if (file.status !== 'open') {
        return redirect(reply, `/archive/${slug}?notice=file-sealed`);
      }

      const context = await loadUserContext(db, request.user.id);
      const lock = fileLockState({
        file,
        discoveredClues: context.discoveredClues,
        unlockedNumbers: context.unlockedNumbers,
      });

      if (lock.locked) {
        const notice =
          lock.reason === 'code'
            ? 'file-sealed'
            : lock.reason === 'prerequisite'
              ? 'prerequisite-missing'
              : 'clue-required';
        return redirect(reply, `/archive/${slug}?notice=${notice}`);
      }

      const challenge = await loadChallenge(db, file.id);
      if (!challenge) return redirect(reply, `/archive/${slug}?notice=file-sealed`);

      const state = await submissionState(db, request.user.id, challenge);
      if (state.hasCorrect) return redirect(reply, `/archive/${slug}?notice=already-submitted`);
      if (state.remaining <= 0) return redirect(reply, `/archive/${slug}?notice=attempts-exhausted`);

      const parsedAnswer = validateAnswerSubmission(request.body?.answer);
      if (parsedAnswer.error) return redirect(reply, `/archive/${slug}?notice=answer-required`);

      const wallet = await db.one(
        'select address from user_wallets where user_id = $1 and is_primary = true',
        [request.user.id]
      );
      if (!wallet) return redirect(reply, `/archive/${slug}?notice=wallet-required`);

      // The holding rule is read from the chain here, not from anything the
      // browser sent, and again at admin approval. A wallet that sells between
      // the two is refused at the second check.
      let balance;
      try {
        balance = await balanceReader(wallet.address);
      } catch (error) {
        request.log.warn({ err: error.message }, 'balance read failed on submit');
        return redirect(reply, `/archive/${slug}?notice=balance-unavailable`);
      }

      const required = parseUnits(file.min_holding, config.solana.decimals);
      if (balance.baseUnits < required) {
        return redirect(reply, `/archive/${slug}?notice=submission-holding`);
      }

      // The hash is fetched only here, in the handler that compares it.
      const sealed = await db.one(
        'select answer_hash, case_sensitive from challenges where id = $1',
        [challenge.id]
      );

      const correct = challengeAnswerMatches(parsedAnswer.value, sealed?.answer_hash ?? '', {
        caseSensitive: Boolean(sealed?.case_sensitive),
      });

      let ciphertext;
      let digest;
      try {
        ciphertext = sealAnswer(parsedAnswer.value, config.answerEncKey);
        digest = answerDigest(parsedAnswer.value, config.answerEncKey);
      } catch (error) {
        request.log.error({ err: error.message }, 'could not seal a submission');
        return redirect(reply, `/archive/${slug}?notice=verifier-unavailable`);
      }

      await db.query(
        `insert into submissions
           (file_id, challenge_id, user_id, attempt_no, wallet_address,
            answer_ciphertext, answer_digest, status,
            holding_checked_at, holding_snapshot_f106, holding_required_f106,
            holding_satisfied, ip_hash)
         values ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9, $10, $11, $12)`,
        [
          file.id,
          challenge.id,
          request.user.id,
          state.attempts + 1,
          wallet.address,
          ciphertext,
          digest,
          correct ? 'correct' : 'incorrect',
          balance.amount,
          file.min_holding,
          true,
          ipHash(request),
        ]
      );

      if (correct) {
        await db.query(
          `insert into investigation_logs (user_id, entry_type, file_id, message, metadata)
           values ($1, 'puzzle', $2, $3, $4::jsonb)`,
          [
            request.user.id,
            file.id,
            `Submitted a correct answer for ${fileLabel(file.file_number)} — ${file.title}`,
            JSON.stringify({ fileNumber: Number(file.file_number) }),
          ]
        );
      }

      return redirect(
        reply,
        `/archive/${slug}?notice=${correct ? 'answer-correct' : 'answer-incorrect'}`
      );
    }
  );
}
