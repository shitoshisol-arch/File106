-- =====================================================================
-- FILE106 — THE MYSTERY
-- Migration 0005: investigation system
--
-- Adds the story layer on top of the existing archive. Nothing here replaces
-- the file, challenge, submission, winner or reward tables; it annotates them.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Files gain a story position, a classified document and an unlock rule.
-- The unlock code is stored only as a scrypt hash, exactly like an answer.
-- ---------------------------------------------------------------------
alter table files
  add column if not exists chapter_no integer,
  add column if not exists classification text,
  add column if not exists lore_body text,
  add column if not exists unlock_code_hash text,
  add column if not exists unlock_hint text,
  add column if not exists required_file_number integer,
  add column if not exists unlock_requires_clue integer,
  add column if not exists is_mystery boolean not null default false,
  add column if not exists mystery_order integer;

alter table files
  add constraint files_chapter_no_positive check (chapter_no is null or chapter_no > 0),
  add constraint files_required_file_number_positive check (required_file_number is null or required_file_number > 0),
  add constraint files_unlock_clue_positive check (unlock_requires_clue is null or unlock_requires_clue > 0),
  add constraint files_unlock_code_shape check (unlock_code_hash is null or unlock_code_hash like 'scrypt$%');

create index if not exists files_mystery_idx
  on files (is_mystery, mystery_order) where is_mystery;

-- ---------------------------------------------------------------------
-- Story chapters. A chapter is published as a whole; the body may contain
-- the same [[SYMBOL:n]] / [[REDACT:n]] markers as a file document.
-- ---------------------------------------------------------------------
create table if not exists story_chapters (
  id uuid primary key default gen_random_uuid(),
  chapter_no integer not null unique check (chapter_no > 0),
  slug text not null unique check (slug ~ '^[a-z0-9-]{1,80}$'),
  eyebrow text not null default 'CHAPTER',
  title text not null,
  summary text not null default '',
  body text not null,
  required_clue_count integer not null default 0 check (required_clue_count >= 0),
  required_file_number integer,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  is_enabled boolean not null default true,
  created_by uuid references admin_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint story_chapters_required_file_positive
    check (required_file_number is null or required_file_number > 0)
);

create trigger story_chapters_set_updated_at before update on story_chapters
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Clues. clue_no drives the public label (CLUE 001) and the hidden
-- data-clue attribute. requires_clue_no creates a chain: a clue cannot be
-- decoded until the previous one has been logged.
-- ---------------------------------------------------------------------
create table if not exists clues (
  id uuid primary key default gen_random_uuid(),
  clue_no integer not null unique check (clue_no > 0),
  slug text not null unique check (slug ~ '^[a-z0-9-]{1,80}$'),
  title text not null,
  body text not null,
  hint text not null default '',
  location text not null default '',
  chapter_no integer,
  file_number integer,
  requires_clue_no integer,
  is_enabled boolean not null default true,
  created_by uuid references admin_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clues_body_length check (char_length(body) <= 12000),
  constraint clues_hint_length check (char_length(hint) <= 800),
  constraint clues_not_self_required check (requires_clue_no is null or requires_clue_no <> clue_no),
  constraint clues_chapter_positive check (chapter_no is null or chapter_no > 0),
  constraint clues_file_positive check (file_number is null or file_number > 0),
  constraint clues_requires_positive check (requires_clue_no is null or requires_clue_no > 0)
);

create trigger clues_set_updated_at before update on clues
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Personal investigation state. One row per user/clue and user/file means a
-- discovery or unlock is idempotent: clicking the same symbol twice cannot
-- inflate progress.
-- ---------------------------------------------------------------------
create table if not exists user_clue_discoveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  clue_id uuid not null references clues(id) on delete cascade,
  discovered_at timestamptz not null default now(),
  source text not null default 'symbol'
         check (source in ('symbol', 'redaction', 'file', 'chapter', 'admin')),
  unique (user_id, clue_id)
);

create index if not exists user_clue_discoveries_user_idx
  on user_clue_discoveries (user_id, discovered_at desc);

create table if not exists file_unlocks (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references files(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  unlock_method text not null default 'open'
                check (unlock_method in ('open', 'code', 'prerequisite', 'clue', 'admin')),
  unique (file_id, user_id)
);

create index if not exists file_unlocks_user_idx
  on file_unlocks (user_id, unlocked_at desc);

-- Optional readable log for the dashboard timeline. Progress itself is
-- derived from the two tables above, so deleting a log row cannot fake it.
create table if not exists investigation_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  entry_type text not null check (entry_type in ('discovery', 'clue', 'puzzle', 'unlock', 'reward')),
  file_id uuid references files(id) on delete set null,
  clue_id uuid references clues(id) on delete set null,
  message text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists investigation_logs_user_idx
  on investigation_logs (user_id, created_at desc);

commit;
