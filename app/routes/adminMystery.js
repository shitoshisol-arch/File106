// Archivist screens for the mystery layer: chapters, clues, submissions,
// manual payouts and per-participant progress.
//
// Registered from inside adminRoutes, so the /admin auth hook and the CSRF
// guard already apply. Two rules are repeated here because they are the point:
//
//   * An approval reads the holding from the chain again. A submission was
//     checked when it was made; the wallet may have sold since.
//   * A reward is confirmed only by a verifier that looked at the chain. A
//     pasted signature on its own marks nothing paid.

import { openAnswer } from '../../scripts/archive/secret-hash.mjs';
import { messageText, validateChapterInput, validateClueInput, validateAdminNote, validateTransactionSignature } from '../lib/validate.js';
import { parseUnits, explorerUrlFor } from '../lib/solana.js';
import { redirect, sendPage } from '../lib/reply.js';
import {
  adminChapterEditorPage,
  adminChaptersPage,
  adminClueEditorPage,
  adminCluesPage,
  adminProgressPage,
  adminRewardPage,
  adminRewardsPage,
  adminSubmissionPage,
  adminSubmissionsPage,
} from '../views/adminMystery.js';

const UUID = /^[0-9a-f-]{36}$/i;

const chapterValues = (row = {}) => ({
  chapterNo: row.chapter_no ?? '',
  slug: row.slug ?? '',
  eyebrow: row.eyebrow ?? '',
  title: row.title ?? '',
  summary: row.summary ?? '',
  body: row.body ?? '',
  requiredClueCount: row.required_clue_count ?? 0,
  requiredFileNumber: row.required_file_number ?? '',
  status: row.status ?? 'draft',
});

const clueValues = (row = {}) => ({
  clueNo: row.clue_no ?? '',
  slug: row.slug ?? '',
  title: row.title ?? '',
  body: row.body ?? '',
  hint: row.hint ?? '',
  location: row.location ?? '',
  chapterNo: row.chapter_no ?? '',
  fileNumber: row.file_number ?? '',
  requiresClueNo: row.requires_clue_no ?? '',
  isEnabled: row.is_enabled ?? true,
});

export async function registerMysteryAdminRoutes(
  app,
  { db, config, balanceReader, transactionVerifier, withCsrf, audit }
) {
  // -------------------------------------------------------------------
  // Story chapters
  // -------------------------------------------------------------------
  app.get('/admin/chapters', async (request, reply) => {
    const chapters = await db.many(
      `select chapter_no, slug, eyebrow, title, status, required_clue_count,
              required_file_number, updated_at
         from story_chapters
        order by chapter_no asc`
    );

    return sendPage(
      reply,
      adminChaptersPage({
        admin: withCsrf(request),
        chapters,
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  app.get('/admin/chapters/new', async (request, reply) =>
    sendPage(
      reply,
      adminChapterEditorPage({
        admin: withCsrf(request),
        values: chapterValues(),
        message: messageText(String(request.query?.notice ?? '')),
      })
    )
  );

  app.post('/admin/chapters', async (request, reply) => {
    const body = request.body || {};
    const { errors, value } = validateChapterInput(body);

    if (Object.keys(errors).length > 0) {
      return sendPage(
        reply,
        adminChapterEditorPage({
          admin: withCsrf(request),
          errors,
          values: chapterValues({ ...body, chapter_no: body.chapterNo, required_clue_count: body.requiredClueCount }),
          message: messageText('form-invalid'),
        }),
        400
      );
    }

    let chapter;
    try {
      chapter = await db.one(
        `insert into story_chapters
           (chapter_no, slug, eyebrow, title, summary, body, required_clue_count,
            required_file_number, status, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         returning id, chapter_no`,
        [
          value.chapterNo,
          value.slug,
          value.eyebrow,
          value.title,
          value.summary,
          value.body,
          value.requiredClueCount,
          value.requiredFileNumber,
          value.status,
          request.admin.id,
        ]
      );
    } catch (error) {
      if (error.code === '23505') {
        return sendPage(
          reply,
          adminChapterEditorPage({
            admin: withCsrf(request),
            errors: { submit: 'That chapter number or slug is already in use.' },
            values: chapterValues({ ...body, chapter_no: body.chapterNo, required_clue_count: body.requiredClueCount }),
            message: messageText('form-invalid'),
          }),
          409
        );
      }
      throw error;
    }

    await audit(db, {
      adminId: request.admin.id,
      action: 'chapter.create',
      entity: 'story_chapters',
      entityId: chapter.id,
      after: { chapterNo: value.chapterNo, slug: value.slug, status: value.status },
    });

    return redirect(reply, `/admin/chapters/${chapter.id}?notice=chapter-created`);
  });

  app.get('/admin/chapters/:id', async (request, reply) => {
    if (!UUID.test(request.params.id)) return redirect(reply, '/admin/chapters?notice=chapter-unknown');
    const chapter = await db.one('select * from story_chapters where id = $1', [request.params.id]);
    if (!chapter) return redirect(reply, '/admin/chapters?notice=chapter-unknown');

    return sendPage(
      reply,
      adminChapterEditorPage({
        admin: withCsrf(request),
        chapter,
        values: chapterValues(chapter),
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  app.post('/admin/chapters/:id', async (request, reply) => {
    if (!UUID.test(request.params.id)) return redirect(reply, '/admin/chapters?notice=chapter-unknown');
    const before = await db.one('select * from story_chapters where id = $1', [request.params.id]);
    if (!before) return redirect(reply, '/admin/chapters?notice=chapter-unknown');

    const body = request.body || {};
    const { errors, value } = validateChapterInput(body);

    if (Object.keys(errors).length > 0) {
      return sendPage(
        reply,
        adminChapterEditorPage({
          admin: withCsrf(request),
          chapter: before,
          errors,
          values: chapterValues({ ...before, ...body, chapter_no: body.chapterNo, required_clue_count: body.requiredClueCount }),
          message: messageText('form-invalid'),
        }),
        400
      );
    }

    try {
      await db.query(
        `update story_chapters
            set chapter_no = $2, slug = $3, eyebrow = $4, title = $5, summary = $6,
                body = $7, required_clue_count = $8, required_file_number = $9, status = $10
          where id = $1`,
        [
          before.id,
          value.chapterNo,
          value.slug,
          value.eyebrow,
          value.title,
          value.summary,
          value.body,
          value.requiredClueCount,
          value.requiredFileNumber,
          value.status,
        ]
      );
    } catch (error) {
      if (error.code === '23505') {
        return sendPage(
          reply,
          adminChapterEditorPage({
            admin: withCsrf(request),
            chapter: before,
            errors: { submit: 'That chapter number or slug is already in use.' },
            values: chapterValues({ ...before, ...body, chapter_no: body.chapterNo, required_clue_count: body.requiredClueCount }),
            message: messageText('form-invalid'),
          }),
          409
        );
      }
      throw error;
    }

    await audit(db, {
      adminId: request.admin.id,
      action: 'chapter.update',
      entity: 'story_chapters',
      entityId: before.id,
      before: { chapterNo: before.chapter_no, slug: before.slug, status: before.status },
      after: { chapterNo: value.chapterNo, slug: value.slug, status: value.status },
    });

    return redirect(reply, `/admin/chapters/${before.id}?notice=chapter-saved`);
  });

  // -------------------------------------------------------------------
  // Clues
  // -------------------------------------------------------------------
  app.get('/admin/clues', async (request, reply) => {
    const clues = await db.many(
      `select clue_no, slug, title, location, chapter_no, file_number,
              requires_clue_no, is_enabled, updated_at
         from clues
        order by clue_no asc`
    );

    return sendPage(
      reply,
      adminCluesPage({
        admin: withCsrf(request),
        clues,
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  app.get('/admin/clues/new', async (request, reply) =>
    sendPage(
      reply,
      adminClueEditorPage({
        admin: withCsrf(request),
        values: clueValues(),
        message: messageText(String(request.query?.notice ?? '')),
      })
    )
  );

  app.post('/admin/clues', async (request, reply) => {
    const body = request.body || {};
    const { errors, value } = validateClueInput(body);

    if (Object.keys(errors).length > 0) {
      return sendPage(
        reply,
        adminClueEditorPage({
          admin: withCsrf(request),
          errors,
          values: clueValues({
            ...body,
            clue_no: body.clueNo,
            chapter_no: body.chapterNo,
            file_number: body.fileNumber,
            requires_clue_no: body.requiresClueNo,
            is_enabled: Boolean(body.isEnabled),
          }),
          message: messageText('form-invalid'),
        }),
        400
      );
    }

    let clue;
    try {
      clue = await db.one(
        `insert into clues
           (clue_no, slug, title, body, hint, location, chapter_no, file_number,
            requires_clue_no, is_enabled, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         returning id, clue_no`,
        [
          value.clueNo,
          value.slug,
          value.title,
          value.body,
          value.hint,
          value.location,
          value.chapterNo,
          value.fileNumber,
          value.requiresClueNo,
          value.isEnabled,
          request.admin.id,
        ]
      );
    } catch (error) {
      if (error.code === '23505') {
        return sendPage(
          reply,
          adminClueEditorPage({
            admin: withCsrf(request),
            errors: { submit: 'That clue number or slug is already in use.' },
            values: clueValues({ ...body, clue_no: body.clueNo }),
            message: messageText('form-invalid'),
          }),
          409
        );
      }
      throw error;
    }

    await audit(db, {
      adminId: request.admin.id,
      action: 'clue.create',
      entity: 'clues',
      entityId: clue.id,
      after: { clueNo: value.clueNo, slug: value.slug, enabled: value.isEnabled },
    });

    return redirect(reply, `/admin/clues/${clue.id}?notice=clue-created`);
  });

  app.get('/admin/clues/:id', async (request, reply) => {
    if (!UUID.test(request.params.id)) return redirect(reply, '/admin/clues?notice=clue-unknown');
    const clue = await db.one('select * from clues where id = $1', [request.params.id]);
    if (!clue) return redirect(reply, '/admin/clues?notice=clue-unknown');

    return sendPage(
      reply,
      adminClueEditorPage({
        admin: withCsrf(request),
        clue,
        values: clueValues(clue),
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  app.post('/admin/clues/:id', async (request, reply) => {
    if (!UUID.test(request.params.id)) return redirect(reply, '/admin/clues?notice=clue-unknown');
    const before = await db.one('select * from clues where id = $1', [request.params.id]);
    if (!before) return redirect(reply, '/admin/clues?notice=clue-unknown');

    const body = request.body || {};
    const { errors, value } = validateClueInput(body);

    if (Object.keys(errors).length > 0) {
      return sendPage(
        reply,
        adminClueEditorPage({
          admin: withCsrf(request),
          clue: before,
          errors,
          values: clueValues({
            ...before,
            ...body,
            clue_no: body.clueNo,
            chapter_no: body.chapterNo,
            file_number: body.fileNumber,
            requires_clue_no: body.requiresClueNo,
            is_enabled: Boolean(body.isEnabled),
          }),
          message: messageText('form-invalid'),
        }),
        400
      );
    }

    try {
      await db.query(
        `update clues
            set clue_no = $2, slug = $3, title = $4, body = $5, hint = $6,
                location = $7, chapter_no = $8, file_number = $9,
                requires_clue_no = $10, is_enabled = $11
          where id = $1`,
        [
          before.id,
          value.clueNo,
          value.slug,
          value.title,
          value.body,
          value.hint,
          value.location,
          value.chapterNo,
          value.fileNumber,
          value.requiresClueNo,
          value.isEnabled,
        ]
      );
    } catch (error) {
      if (error.code === '23505') {
        return sendPage(
          reply,
          adminClueEditorPage({
            admin: withCsrf(request),
            clue: before,
            errors: { submit: 'That clue number or slug is already in use.' },
            values: clueValues({ ...before, ...body, clue_no: body.clueNo }),
            message: messageText('form-invalid'),
          }),
          409
        );
      }
      throw error;
    }

    await audit(db, {
      adminId: request.admin.id,
      action: 'clue.update',
      entity: 'clues',
      entityId: before.id,
      before: { clueNo: before.clue_no, slug: before.slug, enabled: before.is_enabled },
      after: { clueNo: value.clueNo, slug: value.slug, enabled: value.isEnabled },
    });

    return redirect(reply, `/admin/clues/${before.id}?notice=clue-saved`);
  });

  // -------------------------------------------------------------------
  // Submissions
  // -------------------------------------------------------------------
  app.get('/admin/submissions', async (request, reply) => {
    const filter = String(request.query?.status ?? '');
    const allowed = new Set(['pending_review', 'correct', 'approved', 'rejected', 'rewarded', 'incorrect']);
    const status = allowed.has(filter) ? filter : null;

    const submissions = await db.many(
      `select s.id, s.status, s.attempt_no, s.submitted_at, s.wallet_address,
              s.holding_snapshot_f106::text as holding_snapshot,
              u.username, f.file_number, f.title, f.slug
         from submissions s
         join users u on u.id = s.user_id
         join files f on f.id = s.file_id
        where $1::text is null or s.status = $1
        order by s.submitted_at desc
        limit 200`,
      [status]
    );

    const counts = await db.one(
      `select
         count(*) filter (where status in ('pending_review','correct'))::int as awaiting,
         count(*) filter (where status = 'approved')::int as approved,
         count(*) filter (where status = 'rewarded')::int as rewarded,
         count(*)::int as total
       from submissions`
    );

    return sendPage(
      reply,
      adminSubmissionsPage({
        admin: withCsrf(request),
        submissions,
        counts,
        status: status ?? '',
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  app.get('/admin/submissions/:id', async (request, reply) => {
    if (!UUID.test(request.params.id)) return redirect(reply, '/admin/submissions?notice=submission-unknown');

    const submission = await db.one(
      `select s.id, s.user_id, s.status, s.attempt_no, s.wallet_address,
              s.submitted_at, s.holding_checked_at, s.holding_snapshot_f106::text as holding_snapshot,
              s.holding_required_f106::text as holding_required, s.holding_satisfied,
              s.answer_ciphertext, s.reviewed_at, s.admin_note,
              u.username, u.email,
              f.id as file_id, f.file_number, f.slug, f.title, f.status as file_status,
              f.reward_amount_f106::text as reward, f.min_holding_f106::text as min_holding,
              f.max_winners,
              c.prompt, c.answer_format
         from submissions s
         join users u on u.id = s.user_id
         join files f on f.id = s.file_id
         join challenges c on c.id = s.challenge_id
        where s.id = $1`,
      [request.params.id]
    );

    if (!submission) return redirect(reply, '/admin/submissions?notice=submission-unknown');

    let answer = '';
    let answerError = '';
    try {
      answer = openAnswer(submission.answer_ciphertext, config.answerEncKey);
    } catch (error) {
      request.log.warn({ submissionId: submission.id, err: error.message }, 'submitted answer unreadable');
      answerError = 'The stored answer could not be decrypted with the configured key.';
    }

    const outcome = await db.one(
      `select w.id as winner_id, w.status as winner_status,
              r.id as reward_id, r.reward_no, r.payment_status,
              r.amount_f106::text as amount, tx.signature, tx.explorer_url
         from winners w
         left join rewards r on r.winner_id = w.id
         left join transactions tx on tx.id = r.confirmed_transaction_id
        where w.submission_id = $1`,
      [submission.id]
    );

    return sendPage(
      reply,
      adminSubmissionPage({
        admin: withCsrf(request),
        submission,
        answer,
        answerError,
        outcome,
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  app.post('/admin/submissions/:id/approve', async (request, reply) => {
    if (!UUID.test(request.params.id)) return redirect(reply, '/admin/submissions?notice=submission-unknown');

    const note = validateAdminNote(request.body?.note);
    if (note.error) return redirect(reply, `/admin/submissions/${request.params.id}?notice=form-invalid`);

    const preview = await db.one(
      'select id, file_id, user_id, wallet_address, status from submissions where id = $1',
      [request.params.id]
    );
    if (!preview) return redirect(reply, '/admin/submissions?notice=submission-unknown');
    if (!['pending_review', 'correct'].includes(preview.status)) {
      return redirect(reply, `/admin/submissions/${preview.id}?notice=submission-not-pending`);
    }

    const file = await db.one(
      `select id, file_number, title, reward_amount_f106::text as reward,
              min_holding_f106::text as min_holding, max_winners
         from files where id = $1`,
      [preview.file_id]
    );
    if (!file) return redirect(reply, '/admin/submissions?notice=submission-unknown');

    // Fresh chain read at approval time. A wallet that no longer holds the
    // minimum does not get a reward record.
    let balance;
    try {
      balance = await balanceReader(preview.wallet_address);
    } catch (error) {
      request.log.warn({ err: error.message }, 'balance read failed on approval');
      return redirect(reply, `/admin/submissions/${preview.id}?notice=balance-unavailable`);
    }

    if (balance.baseUnits < parseUnits(file.min_holding, config.solana.decimals)) {
      return redirect(reply, `/admin/submissions/${preview.id}?notice=holding-failed`);
    }

    let result;
    try {
      result = await db.transaction(async (tx) => {
        const current = await tx.one(
          `select id, file_id, user_id, wallet_address, status
             from submissions where id = $1 for update`,
          [preview.id]
        );

        if (!current || !['pending_review', 'correct'].includes(current.status)) {
          return { error: 'submission-not-pending' };
        }

        if (file.max_winners) {
          const winners = await tx.value(
            `select count(*)::int as v from winners
              where file_id = $1 and status in ('selected','approved')`,
            [file.id]
          );
          if (Number(winners) >= Number(file.max_winners)) return { error: 'winner-limit' };
        }

        const winner = await tx.one(
          `insert into winners
             (file_id, submission_id, user_id, wallet_address, reward_amount_f106,
              status, selected_by, approved_by, approved_at)
           values ($1, $2, $3, $4, $5, 'approved', $6, $6, now())
           returning id`,
          [file.id, current.id, current.user_id, current.wallet_address, file.reward, request.admin.id]
        );

        const reward = await tx.one(
          `insert into rewards
             (winner_id, user_id, wallet_address, file_id, file_number, amount_f106,
              payment_status, approved_by)
           values ($1, $2, $3, $4, $5, $6, 'awaiting_payment', $7)
           returning id, reward_no`,
          [
            winner.id,
            current.user_id,
            current.wallet_address,
            file.id,
            file.file_number,
            file.reward,
            request.admin.id,
          ]
        );

        await tx.query(
          `update submissions
              set status = 'approved', reviewed_by = $2, reviewed_at = now(), admin_note = $3
            where id = $1`,
          [current.id, request.admin.id, note.value || null]
        );

        await tx.query(
          `update files
              set status = case when status = 'open' then 'locked' else status end
            where id = $1`,
          [file.id]
        );

        await tx.query(
          `insert into investigation_logs (user_id, entry_type, file_id, message, metadata)
           values ($1, 'reward', $2, $3, $4::jsonb)`,
          [
            current.user_id,
            file.id,
            `A submission for FILE ${String(file.file_number).padStart(3, '0')} was approved. A reward is awaiting manual payment.`,
            JSON.stringify({ fileNumber: Number(file.file_number), rewardNo: Number(reward.reward_no) }),
          ]
        );

        return { winnerId: winner.id, rewardId: reward.id, rewardNo: reward.reward_no };
      });
    } catch (error) {
      if (error.code === '23505') {
        const notice = String(error.constraint ?? '').includes('wallet')
          ? 'winner-duplicate'
          : 'submission-not-pending';
        return redirect(reply, `/admin/submissions/${preview.id}?notice=${notice}`);
      }
      throw error;
    }

    if (result?.error) {
      return redirect(reply, `/admin/submissions/${preview.id}?notice=${result.error}`);
    }

    await audit(db, {
      adminId: request.admin.id,
      action: 'submission.approve',
      entity: 'submissions',
      entityId: preview.id,
      after: {
        fileNumber: file.file_number,
        winnerId: result.winnerId,
        rewardNo: String(result.rewardNo),
        holding: balance.amount,
      },
    });

    request.log.info({ submissionId: preview.id, rewardNo: String(result.rewardNo) }, 'submission approved');
    return redirect(reply, `/admin/submissions/${preview.id}?notice=submission-approved`);
  });

  app.post('/admin/submissions/:id/reject', async (request, reply) => {
    if (!UUID.test(request.params.id)) return redirect(reply, '/admin/submissions?notice=submission-unknown');

    const note = validateAdminNote(request.body?.note);
    if (note.error) return redirect(reply, `/admin/submissions/${request.params.id}?notice=form-invalid`);

    const before = await db.one(
      'select id, file_id, status from submissions where id = $1',
      [request.params.id]
    );
    if (!before) return redirect(reply, '/admin/submissions?notice=submission-unknown');
    if (!['pending_review', 'correct'].includes(before.status)) {
      return redirect(reply, `/admin/submissions/${before.id}?notice=submission-not-pending`);
    }

    await db.transaction(async (tx) => {
      await tx.query(
        `update submissions
            set status = 'rejected', reviewed_by = $2, reviewed_at = now(), admin_note = $3
          where id = $1`,
        [before.id, request.admin.id, note.value || null]
      );

      // If the file was only locked because an answer was under review, and no
      // other answer is waiting, reopen it.
      const remaining = await tx.value(
        `select count(*)::int as v from submissions
          where file_id = $1 and status in ('pending_review','correct')`,
        [before.file_id]
      );
      if (Number(remaining) === 0) {
        await tx.query(
          `update files set status = 'open' where id = $1 and status = 'locked'`,
          [before.file_id]
        );
      }
    });

    await audit(db, {
      adminId: request.admin.id,
      action: 'submission.reject',
      entity: 'submissions',
      entityId: before.id,
      before: { status: before.status },
      after: { status: 'rejected', note: note.value || null },
    });

    return redirect(reply, `/admin/submissions/${before.id}?notice=submission-rejected`);
  });

  // -------------------------------------------------------------------
  // Rewards and manual payment evidence
  // -------------------------------------------------------------------
  app.get('/admin/rewards', async (request, reply) => {
    const rewards = await db.many(
      `select r.id, r.reward_no, r.amount_f106::text as amount, r.payment_status,
              r.approved_at, r.confirmed_at, r.wallet_address, r.file_number,
              f.title, u.username, tx.signature, tx.explorer_url
         from rewards r
         join files f on f.id = r.file_id
         join users u on u.id = r.user_id
         left join transactions tx on tx.id = r.confirmed_transaction_id
        order by r.approved_at desc
        limit 200`
    );

    const counts = await db.one(
      `select
         count(*) filter (where payment_status = 'awaiting_payment')::int as awaiting,
         count(*) filter (where payment_status = 'payment_sent')::int as sent,
         count(*) filter (where payment_status = 'confirmed')::int as confirmed,
         coalesce(sum(amount_f106) filter (where payment_status = 'confirmed'), 0)::text as confirmed_total
       from rewards`
    );

    return sendPage(
      reply,
      adminRewardsPage({
        admin: withCsrf(request),
        rewards,
        counts,
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  app.get('/admin/rewards/:id', async (request, reply) => {
    if (!UUID.test(request.params.id)) return redirect(reply, '/admin/rewards?notice=reward-unknown');

    const reward = await db.one(
      `select r.id, r.reward_no, r.amount_f106::text as amount, r.payment_status,
              r.approved_at, r.confirmed_at, r.wallet_address, r.file_number,
              f.title, f.slug, u.username, u.email,
              w.submission_id, w.id as winner_id
         from rewards r
         join files f on f.id = r.file_id
         join users u on u.id = r.user_id
         join winners w on w.id = r.winner_id
        where r.id = $1`,
      [request.params.id]
    );

    if (!reward) return redirect(reply, '/admin/rewards?notice=reward-unknown');

    const transactions = await db.many(
      `select id, signature, explorer_url, submitted_at, verification_status,
              verified_at, failure_reason, mint_address, from_address, to_address,
              amount_base_units, slot, block_time
         from transactions
        where reward_id = $1
        order by submitted_at desc`,
      [reward.id]
    );

    return sendPage(
      reply,
      adminRewardPage({
        admin: withCsrf(request),
        reward,
        transactions,
        cluster: config.solana.cluster,
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  app.post('/admin/rewards/:id/transaction', async (request, reply) => {
    if (!UUID.test(request.params.id)) return redirect(reply, '/admin/rewards?notice=reward-unknown');

    const parsed = validateTransactionSignature(request.body?.signature);
    if (parsed.error) return redirect(reply, `/admin/rewards/${request.params.id}?notice=transaction-invalid`);

    const reward = await db.one(
      `select id, reward_no, user_id, wallet_address, file_number, amount_f106::text as amount,
              payment_status
         from rewards where id = $1`,
      [request.params.id]
    );
    if (!reward) return redirect(reply, '/admin/rewards?notice=reward-unknown');
    if (reward.payment_status === 'confirmed') {
      return redirect(reply, `/admin/rewards/${reward.id}?notice=reward-already-confirmed`);
    }

    const duplicate = await db.one('select id from transactions where signature = $1', [parsed.value]);
    if (duplicate) {
      return redirect(reply, `/admin/rewards/${reward.id}?notice=transaction-duplicate`);
    }

    if (typeof transactionVerifier !== 'function') {
      return redirect(reply, `/admin/rewards/${reward.id}?notice=verifier-unavailable`);
    }

    let verification;
    try {
      verification = await transactionVerifier({
        signature: parsed.value,
        recipient: reward.wallet_address,
        expectedBaseUnits: parseUnits(reward.amount, config.solana.decimals).toString(),
      });
    } catch (error) {
      request.log.warn({ err: error.message, rewardId: reward.id }, 'transaction verifier failed');
      return redirect(reply, `/admin/rewards/${reward.id}?notice=verifier-unavailable`);
    }

    const status = verification?.status === 'verified'
      ? 'verified'
      : verification?.status === 'pending'
        ? 'pending'
        : 'failed';

    const evidence = {
      status: verification?.status ?? status,
      reason: verification?.reason ?? '',
      amountBaseUnits: String(verification?.amountBaseUnits ?? 0n),
      mintAddress: verification?.mintAddress ?? null,
      toAddress: verification?.toAddress ?? null,
      slot: verification?.slot ?? null,
    };

    let transaction;
    try {
      transaction = await db.transaction(async (tx) => {
        const row = await tx.one(
          `insert into transactions
             (reward_id, signature, explorer_url, submitted_by, submitted_note,
              verification_status, verified_at, failure_reason, mint_address,
              from_address, to_address, amount_base_units, slot, block_time, rpc_response)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)
           returning id`,
          [
            reward.id,
            parsed.value,
            verification?.explorerUrl ?? explorerUrlFor(parsed.value, config.solana.cluster),
            request.admin.id,
            validateAdminNote(request.body?.note).value || null,
            status,
            status === 'verified' ? new Date() : null,
            status === 'verified' ? null : verification?.reason ?? 'verification did not prove the payment',
            verification?.mintAddress ?? null,
            verification?.fromAddress ?? null,
            verification?.toAddress ?? reward.wallet_address,
            verification?.amountBaseUnits === undefined || verification?.amountBaseUnits === null
              ? null
              : String(verification.amountBaseUnits),
            verification?.slot ?? null,
            verification?.blockTime ?? null,
            JSON.stringify(evidence),
          ]
        );

        if (status === 'verified') {
          await tx.query(
            `update rewards
                set payment_status = 'confirmed',
                    confirmed_transaction_id = $2,
                    confirmed_at = now()
              where id = $1`,
            [reward.id, row.id]
          );

          await tx.query(
            `update submissions set status = 'rewarded'
              where id = (select submission_id from winners where id = (select winner_id from rewards where id = $1))`,
            [reward.id]
          );

          await tx.query(`update files set status = 'completed' where id = (select file_id from rewards where id = $1)`, [
            reward.id,
          ]);

          await tx.query(
            `insert into investigation_logs (user_id, entry_type, file_id, message, metadata)
             values ($1, 'reward', (select file_id from rewards where id = $2), $3, $4::jsonb)`,
            [
              reward.user_id,
              reward.id,
              `Reward #${reward.reward_no} was confirmed on-chain for FILE ${String(reward.file_number).padStart(3, '0')}.`,
              JSON.stringify({ rewardNo: Number(reward.reward_no), signature: parsed.value }),
            ]
          );
        }

        return row;
      });
    } catch (error) {
      if (error.code === '23505') {
        return redirect(reply, `/admin/rewards/${reward.id}?notice=transaction-duplicate`);
      }
      throw error;
    }

    await audit(db, {
      adminId: request.admin.id,
      action: status === 'verified' ? 'reward.confirm' : 'reward.transaction_rejected',
      entity: 'transactions',
      entityId: transaction.id,
      after: {
        rewardNo: String(reward.reward_no),
        signature: parsed.value,
        verification: status,
        reason: verification?.reason || null,
      },
    });

    const notice = status === 'verified' ? 'reward-confirmed' : status === 'pending' ? 'reward-pending' : 'reward-failed';
    return redirect(reply, `/admin/rewards/${reward.id}?notice=${notice}`);
  });

  // -------------------------------------------------------------------
  // Participant progress
  // -------------------------------------------------------------------
  app.get('/admin/progress', async (request, reply) => {
    const users = await db.many(
      `select u.id, u.username, u.email, u.status, u.created_at,
              (select count(*)::int from user_clue_discoveries d where d.user_id = u.id) as clues,
              (select count(*)::int from file_unlocks f where f.user_id = u.id) as unlocks,
              (select count(*)::int from submissions s where s.user_id = u.id) as submissions,
              (select count(*)::int from winners w where w.user_id = u.id and w.status = 'approved') as wins,
              (select coalesce(sum(r.amount_f106), 0)::text from rewards r
                where r.user_id = u.id and r.payment_status = 'confirmed') as confirmed,
              greatest(
                u.created_at,
                coalesce((select max(l.created_at) from investigation_logs l where l.user_id = u.id), u.created_at)
              ) as last_activity
         from users u
        where u.status <> 'deleted'
        order by last_activity desc
        limit 200`
    );

    return sendPage(
      reply,
      adminProgressPage({
        admin: withCsrf(request),
        users,
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });
}
