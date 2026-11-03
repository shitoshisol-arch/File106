// The public investigation terminal: chapter index, chapter pages, and the
// server-side clue decoder used by hidden symbols and redacted passages.
//
// The decoder is deliberately not a static list. It checks the clue exists,
// that its predecessor has been recovered, and records the discovery once per
// account. The clue text is returned only after that check.

import { fileLockState, chapterLockState } from '../lib/mystery.js';
import { loadUserContext, recordClueDiscovery } from '../lib/investigation.js';
import { clueLabel } from '../lib/mystery.js';
import { messageText } from '../lib/validate.js';
import { sendPage, redirect } from '../lib/reply.js';
import { investigatePage, chapterPage } from '../views/investigate.js';

const PUBLIC_STATUSES = ['open', 'locked', 'closed', 'completed'];

async function publicMysteryFiles(db) {
  return db.many(
    `select file_number, slug, title, classification, status,
            required_file_number, unlock_requires_clue,
            (unlock_code_hash is not null) as has_unlock_code
       from files
      where is_enabled and is_mystery and status = any($1::text[])
      order by mystery_order asc nulls last, file_number asc`,
    [PUBLIC_STATUSES]
  );
}

function decorateFile(row, context) {
  const lock = fileLockState({
    file: row,
    discoveredClues: context.discoveredClues,
    unlockedNumbers: context.unlockedNumbers,
  });
  return {
    ...row,
    locked: lock.locked,
    lockReason: lock.reason,
    requiredFile: lock.requiredFile ?? null,
    requiredClue: lock.requiredClue ?? null,
    recovered: context.unlockedNumbers.has(Number(row.file_number)),
  };
}

function decorateChapter(row, context) {
  const lock = chapterLockState({
    chapter: row,
    discoveredCount: context.discoveredClues.size,
    unlockedNumbers: context.unlockedNumbers,
  });

  let lockMessage = 'The chapter is still encrypted.';
  if (lock.reason === 'clues') {
    lockMessage = `recover ${lock.missing} more clue(s).`;
  } else if (lock.reason === 'file') {
    lockMessage = `open FILE ${String(lock.requiredFile).padStart(3, '0')} first.`;
  }

  return { ...row, locked: lock.locked, lockReason: lock.reason, lockMessage };
}

export async function investigateRoutes(app, { db }) {
  app.get('/investigate', async (request, reply) => {
    const user = request.user;
    const context = await loadUserContext(db, user?.id);

    const [chapterRows, files] = await Promise.all([
      db.many(
        `select chapter_no, slug, eyebrow, title, summary, required_clue_count,
                required_file_number, updated_at
           from story_chapters
          where status = 'published' and is_enabled
          order by chapter_no asc`
      ),
      publicMysteryFiles(db),
    ]);

    const chapters = chapterRows.map((row) => decorateChapter(row, context));
    const decoratedFiles = files.map((row) => decorateFile(row, context));

    const investigation = await investigationFor(db, user?.id);

    return sendPage(
      reply,
      investigatePage({
        session: request.session,
        signedIn: Boolean(user),
        username: user?.username ?? '',
        chapters,
        files: decoratedFiles,
        investigation,
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  app.get('/investigate/chapter/:number', async (request, reply) => {
    const number = Number.parseInt(String(request.params.number ?? ''), 10);
    if (!Number.isInteger(number) || number < 1 || number > 99) return reply.callNotFound();

    const chapter = await db.one(
      `select chapter_no, slug, eyebrow, title, summary, body,
              required_clue_count, required_file_number, updated_at
         from story_chapters
        where chapter_no = $1 and status = 'published' and is_enabled`,
      [number]
    );

    if (!chapter) return reply.callNotFound();

    const user = request.user;
    const context = await loadUserContext(db, user?.id);
    const decorated = decorateChapter(chapter, context);
    const investigation = await investigationFor(db, user?.id);
    const next = await db.one(
      `select chapter_no, slug, eyebrow, title, summary, required_clue_count, required_file_number, updated_at
         from story_chapters
        where chapter_no > $1 and status = 'published' and is_enabled
        order by chapter_no asc
        limit 1`,
      [number]
    );

    return sendPage(
      reply,
      chapterPage({
        session: request.session,
        signedIn: Boolean(user),
        username: user?.username ?? '',
        chapter: decorated,
        locked: decorated.locked,
        next,
        investigation,
        message: messageText(String(request.query?.notice ?? '')),
      })
    );
  });

  app.post(
    '/api/mystery/clue',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const raw = request.body?.clueNo;
      const clueNo = Number.parseInt(String(raw ?? ''), 10);

      if (!Number.isInteger(clueNo) || clueNo < 1 || clueNo > 999) {
        return reply.code(400).send({ error: 'clue_invalid', message: messageText('clue-unknown') });
      }

      const clue = await db.one(
        `select id, clue_no, title, body, hint, location, requires_clue_no
           from clues
          where clue_no = $1 and is_enabled`,
        [clueNo]
      );

      if (!clue) {
        return reply.code(404).send({ error: 'clue_unknown', message: messageText('clue-unknown') });
      }

      const user = request.user;
      const context = await loadUserContext(db, user?.id);

      if (clue.requires_clue_no && !context.discoveredClues.has(Number(clue.requires_clue_no))) {
        return reply.code(403).send({
          error: 'clue_locked',
          message: messageText('clue-locked'),
          hint: clue.hint || '',
          requires: clueLabel(clue.requires_clue_no),
        });
      }

      const source = request.body?.source === 'redaction' ? 'redaction' : 'symbol';
      const first = await recordClueDiscovery(db, {
        userId: user?.id,
        clue,
        source,
      });

      return reply.send({
        clueNo: Number(clue.clue_no),
        label: clueLabel(clue.clue_no),
        title: clue.title,
        body: clue.body,
        hint: clue.hint,
        location: clue.location,
        logged: Boolean(user),
        first,
      });
    }
  );
}

async function investigationFor(db, userId) {
  const context = await loadUserContext(db, userId);
  const totals = await db.one(
    `select
       (select count(*)::int from clues where is_enabled) as clues_total,
       (select count(*)::int from files
         where is_enabled and status in ('open','locked','closed','completed')) as files_total,
       (select count(*)::int from challenges c join files f on f.id = c.file_id
         where f.is_enabled and f.status in ('open','locked','closed','completed')) as puzzles_total,
       (select count(*)::int from submissions s
         where s.user_id = $1 and s.status in ('correct','approved','rewarded')) as solved,
       (select count(*)::int from submissions s
         where s.user_id = $1 and s.status = 'pending_review') as pending,
       (select count(*)::int from winners w where w.user_id = $1 and w.status = 'approved') as wins,
       (select coalesce(sum(r.amount_f106), 0)::text from rewards r
         where r.user_id = $1 and r.payment_status = 'confirmed') as confirmed`,
    [userId ?? null]
  );

  const cluesTotal = Number(totals?.clues_total ?? 0);
  const filesTotal = Number(totals?.files_total ?? 0);
  const puzzlesTotal = Number(totals?.puzzles_total ?? 0);
  const solved = Number(totals?.solved ?? 0);
  const total = cluesTotal + filesTotal + puzzlesTotal;
  const done = context.discoveredClues.size + context.unlockedNumbers.size + solved;

  return {
    cluesFound: context.discoveredClues.size,
    cluesTotal,
    filesUnlocked: context.unlockedNumbers.size,
    filesTotal,
    puzzlesSolved: solved,
    puzzlesTotal,
    pending: Number(totals?.pending ?? 0),
    wins: Number(totals?.wins ?? 0),
    confirmedF106: totals?.confirmed ?? '0.00000000',
    discoveries: context.discoveries,
    unlocks: context.unlocks,
    submissions: [],
    rewards: [],
    logs: [],
    percent: total === 0 ? 0 : Math.min(100, Math.round((done / total) * 100)),
  };
}
