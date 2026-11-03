-- =====================================================================
-- FILE106 — THE MYSTERY (Stage: mystery layer seed)
--
-- Applied after db/migrations/0005_mystery.sql.
--
-- This seed is FICTIONAL INVESTIGATION CONTENT. It is story material for the
-- ARG: chapters, clues, sealed files and demo access codes. No clue body, no
-- chapter text and no access code is real in any sense; the whole point of the
-- archive is that it keeps its secrets.
--
-- Demo access codes (hashed exactly like answers, never stored in clear):
--   EIGHT-UNDER-SCORE-STAR -> the code that opens the unknown signal
--   TERMINATION-105         -> the code that opens the termination report
-- Demo answers (hashed exactly like answers):
--   8_*                      -> the recurring symbol
--   terminated               -> the designation stamped on the project
--
-- Never run this against a database that holds real participants.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Story chapters. A chapter decrypts when enough clues are recovered and,
-- when set, the required file has been opened.
-- ---------------------------------------------------------------------
insert into story_chapters (
  chapter_no, slug, eyebrow, title, summary, body, required_clue_count,
  required_file_number, status, created_by
) values
  (1, 'project-105-terminated', 'CHAPTER 01', 'PROJECT105: TERMINATED',
   'The experiment was erased. The final event was not.',
   'Project105 was a hidden archive experiment. Its records were deleted and its operators disappeared. The project was marked terminated. A final event appeared in the system afterwards, and the archive kept it.',
   2, 42, 'published', 'a0000000-0000-4000-8000-000000000001'),

  (2, 'the-unexpected-file', 'CHAPTER 02', 'THE UNEXPECTED FILE',
   'After the termination, an unknown file appeared. It could not be deleted.',
   'The unknown file arrived after the termination. It carried the symbol. It had no creator and no origin, and the archive refused to delete it.',
   2, 17, 'published', 'a0000000-0000-4000-8000-000000000001'),

  (3, 'the-symbol', 'CHAPTER 03', 'THE SYMBOL',
   'A strange smiley appeared in recovered documents.',
   'The symbol 8_* appeared in different files, corrupted records and hidden messages. Nobody knows why it exists.',
   3, null, 'published', 'a0000000-0000-4000-8000-000000000001'),

  (4, 'the-secret', 'CHAPTER 04', 'THE SECRET',
   'The original contents of FILE106 are unknown.',
   'Visitors must investigate the archive to uncover fragments of what the unknown file never said.',
   3, 1, 'draft', 'a0000000-0000-4000-8000-000000000001')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Clues. clue_no drives the public label (CLUE 001) and the hidden
-- data-clue attribute. requires_clue_no creates the decode chain.
-- ---------------------------------------------------------------------
insert into clues (
  clue_no, slug, title, body, hint, location, chapter_no, file_number,
  requires_clue_no, is_enabled, created_by
) values
  (1, 'signal-residue', 'SIGNAL RESIDUE',
   'A sequence of numbers survived the deletion: 07, 42, 19, 106, 03, 88, 12, 55. The gaps between the terms are not noise.',
   'Count the gaps between the terms.',
   'FILE 001 / recovered margins', 1, 1, null, true, 'a0000000-0000-4000-8000-000000000001'),

  (2, 'the-passphrase', 'THE PASSPHRASE',
   'The gaps read as an old archive key. The passphrase that opens the termination file is TERMINATION-105.',
   'It is the designation stamped when the project was ended.',
   'FILE 042 / access log', 1, 42, 1, true, 'a0000000-0000-4000-8000-000000000001'),

  (3, 'the-symbol', 'THE SYMBOL',
   'The recovered margin is annotated with the recurring glyph. The glyph is 8_*.',
   'The symbol is not decoration. It is a question.',
   'FILE 017 / signal print', 2, 17, 2, true, 'a0000000-0000-4000-8000-000000000001'),

  (4, 'the-event', 'THE EVENT',
   'The symbol marked the final transmission of the operation the project was terminated for.',
   'The operation number is still redacted.',
   'FILE 017 / transmission log', 3, 17, 3, true, 'a0000000-0000-4000-8000-000000000001'),

  (5, 'the-broadcast', 'THE BROADCAST',
   'FILE106 was not a file that appeared after the termination. It was the termination, broadcast again.',
   'Some files are warnings that were filed as records.',
   'FILE 001 / final index', 4, 1, 4, true, 'a0000000-0000-4000-8000-000000000001')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Mystery files. Numbers 1, 17 and 42 keep the classified archive readable;
-- the file numbers of the token narrative itself (106-109) stay untouched.
-- ---------------------------------------------------------------------
insert into files (
  id, file_number, slug, title, teaser, briefing, difficulty, status,
  reward_amount_f106, min_holding_f106, winner_method, max_winners,
  opens_at, closes_at, classification, lore_body, chapter_no, mystery_order,
  unlock_hint, required_file_number, unlock_requires_clue, is_mystery,
  unlock_code_hash, created_by
) values
  ('fa000000-0000-4000-8000-000000000001', 1, 'file-001', 'THE CORRUPTED RECORD',
   'The first record of the experiment, rewritten before it was written.',
   'Project105 began as a hidden archive experiment. The first record of the experiment was corrupted in transit.',
   'medium', 'open', 0.25, 1, 'first_correct', 1,
   now() - interval '2 days', now() + interval '28 days',
   'PROJECT105',
   'Project105 began inside a hidden archive. The first record of the experiment was corrupted in transit. [[SYMBOL:1]] The residue was logged rather than erased. [[REDACT:2]]',
   1, 1, null, null, null, true, null,
   'a0000000-0000-4000-8000-000000000001'),

  ('fa000000-0000-4000-8000-000000000017', 17, 'file-017', 'THE UNKNOWN SIGNAL',
   'A transmission with no origin and no author.',
   'The unknown file carried the symbol and could not be deleted.',
   'hard', 'locked', 0.25, 1, 'first_correct', 1,
   now() + interval '3 days', now() + interval '31 days',
   'FILE106',
   null,
   2, 2,
   'The glyph is the key. What does it ask you to remember?',
   null, 3, true,
   'scrypt$32768$8$1$cwyBlF5kdcEDL6WFRLuxow$AcWQKKbmpsB5KYDKOH_M7g4JQHigSedclaed9w7nOFI',
   'a0000000-0000-4000-8000-000000000001'),

  ('fa000000-0000-4000-8000-000000000042', 42, 'file-042', 'THE TERMINATION REPORT',
   'The report that was supposed to be deleted.',
   'The termination report was final. The final event was not.',
   'hard', 'locked', 0.25, 1, 'first_correct', 1,
   now() + interval '1 day', now() + interval '21 days',
   'PROJECT105',
   null,
   1, 3,
   'The gaps between the terms are the key.',
   null, 2, true,
   'scrypt$32768$8$1$tqY5URdAwt0UPPEOTVgthQ$YgWDE5zMaaNR73lzIy-v1RNECbuv_4MDa9U0tZ5-8j4',
   'a0000000-0000-4000-8000-000000000001')

on conflict do nothing;

-- ---------------------------------------------------------------------
-- Puzzles. The answers are sealed like every other answer and never leave
-- the server as plaintext.
-- ---------------------------------------------------------------------
insert into challenges (id, file_id, position, prompt, answer_hash, answer_format, max_attempts) values
  ('c1060000-0000-4000-8000-000000000017', 'fa000000-0000-4000-8000-000000000017', 1,
   'What does the recurring symbol ask the archive to remember?',
   'scrypt$32768$8$1$Q-_A1_ANASKY_LXfeYL-eA$p4QYfLW9HUbkqZ5IZ3LNM3AdgouVGUcais3namw1u4c',
   'text', 3),

  ('c1060000-0000-4000-8000-000000000042', 'fa000000-0000-4000-8000-000000000042', 1,
   'What designation was stamped when the project was terminated?',
   'scrypt$32768$8$1$GHWYiNOqCUN929nSwk8o8w$_RjDeSsPldG5yARW2Yf_4JzMJOpOAT41fTlej9HYOeQ',
   'text', 3)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Nothing is paid here. Rewards are created only after an archivist approves
-- a correct submission and confirms a real on-chain transaction.
-- ---------------------------------------------------------------------

commit;
