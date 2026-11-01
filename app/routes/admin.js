// The archivist terminal: staff sign-in, the file manager, sealed answers, and
// private attachments.
//
// Three properties are enforced here rather than trusted:
//
//   * A participant session is not an admin session. The guard below rejects
//     anything under /admin or /api/admin before a handler runs, and it runs at
//     onRequest so an expired session is sent to the sign-in page rather than
//     being reported as a CSRF failure.
//   * An answer reaches the database as a scrypt hash and leaves this file only
//     as a hash. It is not logged, not audited, and not returned to any view.
//   * Every mutation writes an audit row, including the state before the change.
//     The audit table is append-only by trigger, so that record cannot be tidied
//     up afterwards.

import { hashSecret, verifySecret } from '../../scripts/archive/secret-hash.mjs';
import { hashChallengeAnswer } from '../lib/answers.js';
import { csrfToken } from '../lib/csrf.js';
import { dateTimeInput } from '../lib/format.js';
import { ipHash } from '../lib/ip.js';
import { redirect, sendPage } from '../lib/reply.js';
import { destroySession, regenerateSession, saveSession } from '../lib/session.js';
import {
  FILE_STATUSES,
  messageText,
  validateChallengeInput,
  validateFileInput,
  validateLogin,
} from '../lib/validate.js';
import {
  adminFileEditorPage,
  adminFilesPage,
  adminLoginPage,
  adminOverviewPage,
} from '../views/admin.js';

// A hash is always compared, even for an address that does not exist, so the
// response time cannot be used to enumerate archivists.
const DUMMY_HASH = hashSecret('archivist-timing-equaliser');

const LOGIN_LIMIT = { max: 6, timeWindow: '5 minutes' };

const STATUS_SQL = `case when $2::text = 'archived' then now() else archived_at end`;

function audit(db, { adminId, action, entity, entityId = null, before = null, after = null, ip }) {
  return db.query(
    `insert into admin_audit_logs (admin_id, action, entity, entity_id, before_state, after_state, ip_hash)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
    [
      adminId,
      action,
      entity,
      entityId === null ? null : String(entityId),
      before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after),
      ip ?? null,
    ]
  );
}

// Only the fields worth reviewing later; never the answer, never a storage key.
const fileSnapshot = (row) => ({
  fileNumber: row.file_number,
  slug: row.slug,
  title: row.title,
  difficulty: row.difficulty,
  status: row.status,
  reward: row.reward_amount_f106,
  minHolding: row.min_holding_f106,
  winnerMethod: row.winner_method,
  opensAt: row.opens_at,
  closesAt: row.closes_at,
});

function editorValues(file, overrides = {}) {
  if (!file) {
    return {
      difficulty: 'medium',
      winnerMethod: 'first_correct',
      reward: '',
      minHolding: '1',
      ...overrides,
    };
  }

  return {
    fileNumber: file.file_number,
    slug: file.slug,
    title: file.title,
    teaser: file.teaser,
    briefing: file.briefing ?? '',
    difficulty: file.difficulty,
    winnerMethod: file.winner_method,
    reward: file.reward_amount_f106,
    minHolding: file.min_holding_f106,
    maxWinners: file.max_winners ?? '',
    opensAt: dateTimeInput(file.opens_at),
    closesAt: dateTimeInput(file.closes_at),
    ...overrides,
  };
}

function safeFilename(raw) {
  const base = String(raw ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f"]/g, '').trim().slice(0, 180);
  return cleaned || 'attachment';
}

async function loadFile(db, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  return db.one('select * from files where id = $1', [id]);
}

export async function adminRoutes(app, { db, config, uploads }) {
  // Scoped to this plugin: only the upload route accepts a raw body, and it
  // accepts only the types an exhibit may have.
  app.addContentTypeParser(
    config.uploads.allowedMime,
    { parseAs: 'buffer', bodyLimit: config.uploads.maxBytes },
    (request, payload, done) => done(null, payload)
  );

  app.addHook('onRequest', async (request, reply) => {
    const url = request.url.split('?')[0];
    if (!url.startsWith('/admin') && !url.startsWith('/api/admin/')) return;
    if (url === '/admin/login') return;
    if (request.admin) return;

    if (url.startsWith('/api/')) {
      return reply.code(401).send({ error: 'admin_required', message: 'Archivist sign-in required.' });
    }
    return redirect(reply, '/admin/login?notice=admin-required');
  });

  const withCsrf = (request) => ({ ...request.admin, csrf: csrfToken(request.session) });

  // -------------------------------------------------------------------
  // Sign-in
  // -------------------------------------------------------------------
  app.get('/admin/login', async (request, reply) => {
    if (request.admin) return redirect(reply, '/admin');
    return sendPage(
      reply,
      adminLoginPage({
        session: request.session,
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  app.post('/admin/login', { config: { rateLimit: LOGIN_LIMIT } }, async (request, reply) => {
    const body = request.body || {};
    const { errors, value } = validateLogin(body);

    if (Object.keys(errors).length > 0) {
      return sendPage(reply, adminLoginPage({ session: request.session, errors, values: body }), 400);
    }

    const admin = await db.one(
      'select id, email, display_name, role, is_active, password_hash from admin_users where email = $1',
      [value.email]
    );

    const matches = verifySecret(value.password, admin?.password_hash ?? DUMMY_HASH);

    if (!admin || !matches || !admin.is_active) {
      request.log.warn({ email: value.email }, 'failed archivist sign-in');
      return sendPage(
        reply,
        adminLoginPage({
          session: request.session,
          values: { email: value.email },
          message: messageText('invalid-credentials'),
        }),
        401
      );
    }

    await regenerateSession(request.session);
    // The archivist cookie expires sooner than a participant one: this terminal
    // can seal answers and change what the public sees.
    request.session.cookie.maxAge = config.adminSessionTtlHours * 3600 * 1000;
    // A session belongs to one principal: signing in here clears any participant
    // identity rather than stacking two on one cookie.
    delete request.session.userId;
    request.session.adminId = admin.id;
    await saveSession(request.session);

    await db.query('update admin_users set last_login_at = now() where id = $1', [admin.id]);
    await audit(db, {
      adminId: admin.id,
      action: 'admin.sign_in',
      entity: 'admin_users',
      entityId: admin.id,
      ip: ipHash(request),
    });

    request.log.info({ adminId: admin.id, role: admin.role }, 'archivist sign-in');
    return redirect(reply, '/admin');
  });

  app.post('/admin/logout', async (request, reply) => {
    const adminId = request.admin?.id ?? null;
    if (adminId) {
      await audit(db, {
        adminId,
        action: 'admin.sign_out',
        entity: 'admin_users',
        entityId: adminId,
        ip: ipHash(request),
      });
    }
    await destroySession(request.session);
    return redirect(reply, '/admin/login?notice=signed-out');
  });

  // -------------------------------------------------------------------
  // Overview
  // -------------------------------------------------------------------
  app.get('/admin', async (request, reply) => {
    const stats = await db.one(
      `select
         (select count(*)::int from files)                                   as files,
         (select count(*)::int from files where status = 'open')             as open,
         (select count(*)::int from files where status = 'draft')            as draft,
         (select count(*)::int from submissions)                             as submissions,
         (select count(*)::int from submissions where status = 'pending_review') as pending`
    );

    const recent = await db.many(
      `select action, entity, entity_id, created_at
         from admin_audit_logs
        order by created_at desc, id desc
        limit 10`
    );

    return sendPage(
      reply,
      adminOverviewPage({
        admin: withCsrf(request),
        stats,
        recent,
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  // -------------------------------------------------------------------
  // File manager
  // -------------------------------------------------------------------
  app.get('/admin/files', async (request, reply) => {
    const files = await db.many(
      `select f.id, f.file_number, f.slug, f.title, f.status,
              f.reward_amount_f106::text as reward, f.updated_at,
              s.submissions_total
         from files f
         left join v_file_stats s on s.id = f.id
        order by f.file_number asc`
    );

    return sendPage(
      reply,
      adminFilesPage({
        admin: withCsrf(request),
        files,
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  app.get('/admin/files/new', async (request, reply) =>
    sendPage(
      reply,
      adminFileEditorPage({
        admin: withCsrf(request),
        values: editorValues(null),
        message: messageText(String(request.query?.notice ?? '')),
      })
    )
  );

  app.post('/admin/files', async (request, reply) => {
    const body = request.body || {};
    const { errors, value } = validateFileInput(body);

    if (Object.keys(errors).length > 0) {
      return sendPage(
        reply,
        adminFileEditorPage({
          admin: withCsrf(request),
          errors,
          values: editorValues(null, body),
          message: messageText('form-invalid'),
        }),
        400
      );
    }

    let file;
    try {
      file = await db.one(
        `insert into files
           (file_number, slug, title, teaser, briefing, difficulty, status,
            reward_amount_f106, min_holding_f106, winner_method, max_winners,
            opens_at, closes_at, created_by)
         values ($1, $2, $3, $4, $5, $6, 'draft', $7, $8, $9, $10, $11, $12, $13)
         returning id, file_number, slug`,
        [
          value.fileNumber,
          value.slug,
          value.title,
          value.teaser,
          value.briefing || null,
          value.difficulty,
          value.reward,
          value.minHolding,
          value.winnerMethod,
          value.maxWinners,
          value.opensAt,
          value.closesAt,
          request.admin.id,
        ]
      );
    } catch (error) {
      // 23505 is a unique violation: either the number or the slug is taken.
      if (error.code === '23505') {
        return sendPage(
          reply,
          adminFileEditorPage({
            admin: withCsrf(request),
            errors: { submit: 'That file number or slug is already in use.' },
            values: editorValues(null, body),
            message: messageText('form-invalid'),
          }),
          409
        );
      }
      throw error;
    }

    await audit(db, {
      adminId: request.admin.id,
      action: 'file.create',
      entity: 'files',
      entityId: file.id,
      after: { fileNumber: file.file_number, slug: file.slug, title: value.title, status: 'draft' },
      ip: ipHash(request),
    });

    request.log.info({ fileId: file.id }, 'file created');
    return redirect(reply, `/admin/files/${file.id}?notice=file-created`);
  });

  app.get('/admin/files/:id', async (request, reply) => {
    const file = await loadFile(db, request.params.id);
    if (!file) return redirect(reply, '/admin/files?notice=file-unknown');

    // answer_hash is deliberately absent from this select. The editor can set an
    // answer; nothing in the panel can read one back.
    const challenge = await db.one(
      `select id, position, prompt, answer_format, case_sensitive, max_attempts, updated_at
         from challenges
        where file_id = $1
        order by position asc
        limit 1`,
      [file.id]
    );

    const attachments = await db.many(
      `select id, filename, mime_type, byte_size, checksum_sha256, position, created_at
         from file_attachments
        where file_id = $1
        order by position asc, created_at asc`,
      [file.id]
    );

    return sendPage(
      reply,
      adminFileEditorPage({
        admin: withCsrf(request),
        file: {
          ...file,
          reward_amount_f106: String(file.reward_amount_f106),
          min_holding_f106: String(file.min_holding_f106),
        },
        challenge,
        attachments,
        values: {
          ...editorValues({
            ...file,
            reward_amount_f106: String(file.reward_amount_f106),
            min_holding_f106: String(file.min_holding_f106),
          }),
          prompt: challenge?.prompt ?? '',
          answerFormat: challenge?.answer_format ?? 'text',
          maxAttempts: challenge?.max_attempts ?? 1,
        },
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  app.post('/admin/files/:id', async (request, reply) => {
    const before = await loadFile(db, request.params.id);
    if (!before) return redirect(reply, '/admin/files?notice=file-unknown');

    const body = request.body || {};
    const { errors, value } = validateFileInput(body);

    const rerender = (code, errorMap, message) =>
      sendPage(
        reply,
        adminFileEditorPage({
          admin: withCsrf(request),
          file: before,
          errors: errorMap,
          values: editorValues(before, body),
          message,
        }),
        code
      );

    if (Object.keys(errors).length > 0) return rerender(400, errors, messageText('form-invalid'));

    try {
      await db.query(
        `update files
            set file_number = $2, slug = $3, title = $4, teaser = $5, briefing = $6,
                difficulty = $7, reward_amount_f106 = $8, min_holding_f106 = $9,
                winner_method = $10, max_winners = $11, opens_at = $12, closes_at = $13
          where id = $1`,
        [
          before.id,
          value.fileNumber,
          value.slug,
          value.title,
          value.teaser,
          value.briefing || null,
          value.difficulty,
          value.reward,
          value.minHolding,
          value.winnerMethod,
          value.maxWinners,
          value.opensAt,
          value.closesAt,
        ]
      );
    } catch (error) {
      if (error.code === '23505') {
        return rerender(409, { submit: 'That file number or slug is already in use.' }, messageText('form-invalid'));
      }
      throw error;
    }

    const after = await loadFile(db, before.id);
    await audit(db, {
      adminId: request.admin.id,
      action: 'file.update',
      entity: 'files',
      entityId: before.id,
      before: fileSnapshot(before),
      after: fileSnapshot(after),
      ip: ipHash(request),
    });

    return redirect(reply, `/admin/files/${before.id}?notice=file-saved`);
  });

  app.post('/admin/files/:id/status', async (request, reply) => {
    const before = await loadFile(db, request.params.id);
    if (!before) return redirect(reply, '/admin/files?notice=file-unknown');

    const status = String(request.body?.status ?? '');
    if (!FILE_STATUSES.includes(status)) return redirect(reply, `/admin/files/${before.id}?notice=form-invalid`);

    await db.query(`update files set status = $2, archived_at = ${STATUS_SQL} where id = $1`, [before.id, status]);

    await audit(db, {
      adminId: request.admin.id,
      action: 'file.status',
      entity: 'files',
      entityId: before.id,
      before: { status: before.status },
      after: { status },
      ip: ipHash(request),
    });

    request.log.info({ fileId: before.id, from: before.status, to: status }, 'file status changed');
    return redirect(reply, `/admin/files/${before.id}?notice=file-saved`);
  });

  app.post('/admin/files/:id/challenge', async (request, reply) => {
    const file = await loadFile(db, request.params.id);
    if (!file) return redirect(reply, '/admin/files?notice=file-unknown');

    const body = request.body || {};
    const { errors, value } = validateChallengeInput(body);

    if (Object.keys(errors).length > 0) {
      return sendPage(
        reply,
        adminFileEditorPage({
          admin: withCsrf(request),
          file,
          errors,
          values: { ...editorValues(file), prompt: body.prompt ?? '', answerFormat: body.answerFormat ?? 'text' },
          message: messageText('form-invalid'),
        }),
        400
      );
    }

    // The plaintext stops here. Only hashChallengeAnswer's return value is
    // written, and it is never read back into a response.
    const answerHash = hashChallengeAnswer(value.answer, { caseSensitive: value.caseSensitive });

    const existing = await db.one(
      'select id from challenges where file_id = $1 and position = 1',
      [file.id]
    );

    try {
      await db.query(
        `insert into challenges (file_id, position, prompt, answer_hash, answer_format, case_sensitive, max_attempts)
         values ($1, 1, $2, $3, $4, $5, $6)
         on conflict (file_id, position) do update
            set prompt         = excluded.prompt,
                answer_hash    = excluded.answer_hash,
                answer_format  = excluded.answer_format,
                case_sensitive = excluded.case_sensitive,
                max_attempts   = excluded.max_attempts`,
        [file.id, value.prompt, answerHash, value.answerFormat, value.caseSensitive, value.maxAttempts]
      );
    } catch (error) {
      // restrict_violation from challenges_guard: submissions already exist, so
      // the answer is frozen. Letting the admin think a change applied would be
      // worse than refusing it.
      if (error.code === '23001') {
        return sendPage(
          reply,
          adminFileEditorPage({
            admin: withCsrf(request),
            file,
            errors: { answer: messageText('answer-locked') },
            values: { ...editorValues(file), prompt: body.prompt ?? '' },
            message: messageText('answer-locked'),
          }),
          409
        );
      }
      throw error;
    }

    await audit(db, {
      adminId: request.admin.id,
      action: existing ? 'challenge.answer_replaced' : 'challenge.answer_set',
      entity: 'challenges',
      entityId: file.id,
      after: {
        fileNumber: file.file_number,
        answerFormat: value.answerFormat,
        caseSensitive: value.caseSensitive,
        maxAttempts: value.maxAttempts,
      },
      ip: ipHash(request),
    });

    return redirect(reply, `/admin/files/${file.id}?notice=answer-saved`);
  });

  // -------------------------------------------------------------------
  // Attachments: raw PUT, no multipart dependency, no public URL
  // -------------------------------------------------------------------
  app.put('/api/admin/files/:id/attachments', { bodyLimit: config.uploads.maxBytes }, async (request, reply) => {
    const file = await loadFile(db, request.params.id);
    if (!file) return reply.code(404).send({ error: 'file_unknown', message: 'No such file.' });

    const mimeType = String(request.headers['content-type'] ?? '').split(';')[0].trim();
    const filename = safeFilename(request.query?.filename);
    const kind = mimeType.startsWith('image/') ? 'image' : 'document';

    let stored;
    try {
      stored = await uploads.save({ buffer: request.body, mimeType });
    } catch (error) {
      request.log.warn({ err: error.message }, 'attachment rejected');
      return reply.code(error.statusCode ?? 400).send({ error: error.code ?? 'upload_failed', message: error.message });
    }

    const row = await db.one(
      `insert into file_attachments
         (file_id, kind, storage_key, filename, mime_type, byte_size, checksum_sha256, position)
       values ($1, $2, $3, $4, $5, $6, $7,
               coalesce((select max(position) + 1 from file_attachments where file_id = $1), 0))
       returning id, filename, mime_type, byte_size`,
      [file.id, kind, stored.storageKey, filename, mimeType, stored.byteSize, stored.checksumSha256]
    );

    await audit(db, {
      adminId: request.admin.id,
      action: 'attachment.add',
      entity: 'file_attachments',
      entityId: row.id,
      after: { fileId: file.id, filename, mimeType, byteSize: stored.byteSize },
      ip: ipHash(request),
    });

    return reply.code(201).send({ id: row.id, filename: row.filename, byteSize: row.byte_size });
  });

  app.get('/admin/attachments/:id', async (request, reply) => {
    const attachment = await db.one(
      'select id, storage_key, filename, mime_type from file_attachments where id = $1',
      [request.params.id]
    );
    if (!attachment) return reply.callNotFound();

    let buffer;
    try {
      buffer = await uploads.read(attachment.storage_key);
    } catch (error) {
      request.log.warn({ attachmentId: attachment.id, err: error.message }, 'attachment unreadable');
      return reply.code(404).send({ error: 'attachment_missing' });
    }

    // filename* avoids a quoted header a filename could break out of.
    return reply
      .type(attachment.mime_type)
      .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`)
      .header('cache-control', 'private, no-store')
      .send(buffer);
  });

  app.post('/admin/files/:id/attachments/:attachmentId/delete', async (request, reply) => {
    const file = await loadFile(db, request.params.id);
    if (!file) return redirect(reply, '/admin/files?notice=file-unknown');

    const removed = await db.one(
      `delete from file_attachments
        where id = $1 and file_id = $2
        returning id, storage_key, filename`,
      [request.params.attachmentId, file.id]
    );

    if (removed) {
      await uploads.remove(removed.storage_key);
      await audit(db, {
        adminId: request.admin.id,
        action: 'attachment.remove',
        entity: 'file_attachments',
        entityId: removed.id,
        before: { fileId: file.id, filename: removed.filename },
        ip: ipHash(request),
      });
    }

    return redirect(reply, `/admin/files/${file.id}?notice=attachment-removed`);
  });
}
