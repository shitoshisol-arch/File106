// Shared investigation queries and idempotent discovery/unlock recording.

export async function loadUserContext(db, userId) {
  if (!userId) {
    return {
      discoveredClues: new Set(),
      unlockedNumbers: new Set(),
      discoveries: [],
      unlocks: [],
    };
  }

  const [discoveries, unlocks] = await Promise.all([
    db.many(
      `select c.clue_no, c.slug, c.title, c.body, c.hint, c.location,
              d.discovered_at, d.source
         from user_clue_discoveries d
         join clues c on c.id = d.clue_id
        where d.user_id = $1
        order by c.clue_no asc`,
      [userId]
    ),
    db.many(
      `select f.file_number, f.slug, f.title, u.unlocked_at, u.unlock_method
         from file_unlocks u
         join files f on f.id = u.file_id
        where u.user_id = $1
        order by f.file_number asc`,
      [userId]
    ),
  ]);

  return {
    discoveries,
    unlocks,
    discoveredClues: new Set(discoveries.map((row) => Number(row.clue_no))),
    unlockedNumbers: new Set(unlocks.map((row) => Number(row.file_number))),
  };
}

export async function recordClueDiscovery(db, { userId, clue, source = 'symbol' }) {
  if (!userId) return false;

  const inserted = await db.one(
    `insert into user_clue_discoveries (user_id, clue_id, source)
     values ($1, $2, $3)
     on conflict (user_id, clue_id) do nothing
     returning id`,
    [userId, clue.id, source]
  );

  if (!inserted) return false;

  await db.query(
    `insert into investigation_logs (user_id, entry_type, clue_id, message, metadata)
     values ($1, 'clue', $2, $3, $4::jsonb)`,
    [
      userId,
      clue.id,
      `Decoded CLUE ${String(clue.clue_no).padStart(3, '0')} — ${clue.title}`,
      JSON.stringify({ clueNo: Number(clue.clue_no) }),
    ]
  );

  return true;
}

export async function recordFileUnlock(db, { userId, file, method = 'open' }) {
  if (!userId) return false;

  const inserted = await db.one(
    `insert into file_unlocks (file_id, user_id, unlock_method)
     values ($1, $2, $3)
     on conflict (file_id, user_id) do nothing
     returning id`,
    [file.id, userId, method]
  );

  if (!inserted) return false;

  await db.query(
    `insert into investigation_logs (user_id, entry_type, file_id, message, metadata)
     values ($1, 'unlock', $2, $3, $4::jsonb)`,
    [
      userId,
      file.id,
      `Recovered FILE ${String(file.file_number).padStart(3, '0')} — ${file.title}`,
      JSON.stringify({ fileNumber: Number(file.file_number), method }),
    ]
  );

  return true;
}

export async function loadInvestigation(db, userId) {
  if (!userId) {
    return {
      cluesFound: 0,
      cluesTotal: 0,
      filesUnlocked: 0,
      filesTotal: 0,
      puzzlesSolved: 0,
      puzzlesTotal: 0,
      pending: 0,
      wins: 0,
      confirmedF106: '0.00000000',
      discoveries: [],
      unlocks: [],
      submissions: [],
      rewards: [],
      logs: [],
      percent: 0,
    };
  }

  const [totals, discoveries, unlocks, submissions, rewards, logs] = await Promise.all([
    db.one(
      `select
         (select count(*)::int from clues where is_enabled) as clues_total,
         (select count(*)::int from user_clue_discoveries where user_id = $1) as clues_found,
         (select count(*)::int from files
           where is_enabled and status in ('open','locked','closed','completed')) as files_total,
         (select count(*)::int from file_unlocks where user_id = $1) as files_unlocked,
         (select count(*)::int from challenges c
            join files f on f.id = c.file_id
           where f.is_enabled and f.status in ('open','locked','closed','completed')) as puzzles_total,
         (select count(distinct s.challenge_id)::int from submissions s
           where s.user_id = $1 and s.status in ('correct','approved','rewarded')) as puzzles_solved,
         (select count(*)::int from submissions
           where user_id = $1 and status = 'pending_review') as pending,
         (select count(*)::int from winners where user_id = $1 and status = 'approved') as wins,
         (select coalesce(sum(amount_f106), 0)::text from rewards
           where user_id = $1 and payment_status = 'confirmed') as confirmed`,
      [userId]
    ),
    db.many(
      `select c.clue_no, c.slug, c.title, c.body, c.hint, c.location,
              d.discovered_at, d.source
         from user_clue_discoveries d
         join clues c on c.id = d.clue_id
        where d.user_id = $1
        order by c.clue_no asc`,
      [userId]
    ),
    db.many(
      `select f.file_number, f.slug, f.title, u.unlocked_at, u.unlock_method
         from file_unlocks u
         join files f on f.id = u.file_id
        where u.user_id = $1
        order by f.file_number asc`,
      [userId]
    ),
    db.many(
      `select s.id, s.status, s.submitted_at, s.reviewed_at, s.admin_note,
              s.holding_snapshot_f106::text as holding_snapshot,
              f.file_number, f.slug, f.title
         from submissions s
         join files f on f.id = s.file_id
        where s.user_id = $1
        order by s.submitted_at desc`,
      [userId]
    ),
    db.many(
      `select r.id, r.reward_no, r.amount_f106::text as amount, r.payment_status,
              r.approved_at, r.confirmed_at, r.file_number,
              f.slug, f.title,
              tx.signature, tx.explorer_url,
              tx.verification_status
         from rewards r
         join files f on f.id = r.file_id
         left join transactions tx on tx.id = r.confirmed_transaction_id
        where r.user_id = $1
        order by r.approved_at desc`,
      [userId]
    ),
    db.many(
      `select entry_type, message, created_at
         from investigation_logs
        where user_id = $1
        order by created_at desc
        limit 20`,
      [userId]
    ),
  ]);

  const cluesFound = Number(totals?.clues_found ?? 0);
  const filesUnlocked = Number(totals?.files_unlocked ?? 0);
  const puzzlesSolved = Number(totals?.puzzles_solved ?? 0);
  const cluesTotal = Number(totals?.clues_total ?? 0);
  const filesTotal = Number(totals?.files_total ?? 0);
  const puzzlesTotal = Number(totals?.puzzles_total ?? 0);
  const total = cluesTotal + filesTotal + puzzlesTotal;
  const done = cluesFound + filesUnlocked + puzzlesSolved;

  return {
    cluesFound,
    cluesTotal,
    filesUnlocked,
    filesTotal,
    puzzlesSolved,
    puzzlesTotal,
    pending: Number(totals?.pending ?? 0),
    wins: Number(totals?.wins ?? 0),
    confirmedF106: totals?.confirmed ?? '0.00000000',
    discoveries,
    unlocks,
    submissions,
    rewards,
    logs,
    percent: total === 0 ? 0 : Math.min(100, Math.round((done / total) * 100)),
  };
}
