-- =====================================================================
-- FILE106 — THE ARCHIVE
-- Migration 0001: initial schema
--
-- Target:  PostgreSQL 14+ (written against 16)
-- Apply:   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0001_init.sql
-- Verify:  node db/tests/schema.test.mjs
--
-- Conventions
--   * lower_snake_case, plural table names
--   * F106 amounts are numeric(20,8): the mint has 8 decimals
--   * raw on-chain amounts are bigint base units (1 F106 = 100 000 000)
--   * closed value sets use text + CHECK instead of native enums, so adding a
--     value is an ordinary migration rather than ALTER TYPE ... ADD VALUE
--   * sealed tables (transactions, admin_audit_logs) reject UPDATE and DELETE
--   * no extensions required: gen_random_uuid() is built in since PG13
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Administrators
-- ---------------------------------------------------------------------
create table admin_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  display_name  text not null,
  password_hash text not null,
  role          text not null default 'reviewer'
                check (role in ('owner', 'admin', 'reviewer')),
  is_active     boolean not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint admin_users_email_lowercase check (email = lower(email)),
  constraint admin_users_email_shape check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

-- ---------------------------------------------------------------------
-- Participants
-- ---------------------------------------------------------------------
create table users (
  id                uuid primary key default gen_random_uuid(),
  username          text not null unique,
  email             text not null unique,
  password_hash     text not null,
  status            text not null default 'pending_verification'
                    check (status in ('pending_verification', 'active', 'suspended', 'deleted')),
  email_verified_at timestamptz,
  terms_accepted_at timestamptz,
  last_login_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint users_email_lowercase check (email = lower(email)),
  constraint users_email_shape check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint users_username_shape check (username ~ '^[A-Za-z0-9_.-]{3,32}$'),
  constraint users_username_lowercase check (username = lower(username))
);

create index users_status_idx on users (status, created_at desc);

-- ---------------------------------------------------------------------
-- Wallet links. One address may belong to exactly one account, which is
-- the primary anti-sybil constraint in the whole system.
-- ---------------------------------------------------------------------
create table user_wallets (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users (id) on delete cascade,
  address               text not null,
  is_primary            boolean not null default false,
  verified_at           timestamptz not null default now(),
  proof_nonce           text not null,
  proof_message         text not null,
  proof_signature       text not null,
  first_seen_balance_f106 numeric(20, 8) not null default 0,
  created_at            timestamptz not null default now(),
  constraint user_wallets_address_shape check (address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  constraint user_wallets_balance_non_negative check (first_seen_balance_f106 >= 0)
);

-- A single Solana address can never be attached to two accounts.
create unique index user_wallets_address_key on user_wallets (address);
-- Exactly one primary wallet per account.
create unique index user_wallets_one_primary on user_wallets (user_id) where is_primary;

-- ---------------------------------------------------------------------
-- Email verification / password reset
-- ---------------------------------------------------------------------
create table verification_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete cascade,
  purpose     text not null check (purpose in ('email_verify', 'password_reset')),
  token_hash  bytea not null unique,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

create index verification_tokens_user_idx on verification_tokens (user_id, purpose);

-- ---------------------------------------------------------------------
-- Single-use nonces for wallet-signature authentication. Rows are consumed
-- on use, which makes signed messages replay-proof.
-- ---------------------------------------------------------------------
create table auth_nonces (
  id             uuid primary key default gen_random_uuid(),
  nonce          text not null unique,
  purpose        text not null
                 check (purpose in ('wallet_link', 'wallet_login', 'admin_login', 'admin_wallet_link')),
  wallet_address text,
  user_id        uuid references users (id) on delete cascade,
  issued_at      timestamptz not null default now(),
  expires_at     timestamptz not null,
  consumed_at    timestamptz,
  ip_hash        text
);

create index auth_nonces_expiry_idx on auth_nonces (expires_at);

-- ---------------------------------------------------------------------
-- Server-side sessions. Only a SHA-256 of the cookie token is stored.
-- ---------------------------------------------------------------------
create table sessions (
  id         uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique,
  user_id    uuid references users (id) on delete cascade,
  admin_id   uuid references admin_users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  ip_hash    text,
  user_agent text,
  -- A session belongs to exactly one principal: a participant or an admin.
  constraint sessions_one_principal check (num_nonnulls(user_id, admin_id) = 1)
);

create index sessions_user_idx on sessions (user_id) where revoked_at is null;
create index sessions_admin_idx on sessions (admin_id) where revoked_at is null;

-- ---------------------------------------------------------------------
-- Runtime settings edited from the admin panel
-- ---------------------------------------------------------------------
create table settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_by  uuid references admin_users (id),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Secret files
-- ---------------------------------------------------------------------
create table files (
  id                 uuid primary key default gen_random_uuid(),
  file_number        integer not null unique,
  slug               text not null unique,
  title              text not null,
  teaser             text not null,
  briefing           text,
  difficulty         text not null default 'medium'
                     check (difficulty in ('easy', 'medium', 'hard', 'brutal')),
  status             text not null default 'draft'
                     check (status in ('draft', 'open', 'locked', 'closed', 'completed', 'archived')),
  is_enabled         boolean not null default true,
  reward_amount_f106 numeric(20, 8) not null,
  min_holding_f106   numeric(20, 8) not null default 1,
  winner_method      text not null default 'first_correct'
                     check (winner_method in ('first_correct', 'limited_winners',
                                              'multiple_correct', 'admin_selected',
                                              'time_limited')),
  max_winners        integer,
  opens_at           timestamptz,
  closes_at          timestamptz,
  archived_at        timestamptz,
  created_by         uuid references admin_users (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint files_number_positive check (file_number > 0),
  constraint files_reward_non_negative check (reward_amount_f106 >= 0),
  constraint files_min_holding_non_negative check (min_holding_f106 >= 0),
  constraint files_max_winners_positive check (max_winners is null or max_winners > 0),
  constraint files_window_order check (closes_at is null or opens_at is null or closes_at > opens_at),
  constraint files_slug_shape check (slug ~ '^[a-z0-9-]{1,80}$')
);

create index files_public_idx on files (status, opens_at) where is_enabled;
create index files_live_window_idx on files (opens_at, closes_at) where status = 'open';

create table file_attachments (
  id              uuid primary key default gen_random_uuid(),
  file_id         uuid not null references files (id) on delete cascade,
  kind            text not null check (kind in ('image', 'document')),
  storage_key     text not null,
  filename        text not null,
  mime_type       text not null,
  byte_size       integer not null check (byte_size > 0),
  checksum_sha256 text,
  position        integer not null default 0,
  created_at      timestamptz not null default now(),
  unique (file_id, storage_key)
);

-- ---------------------------------------------------------------------
-- Puzzles. answer_hash never leaves the server: it is excluded from every
-- select used for API responses and cannot change once a file is contested.
-- ---------------------------------------------------------------------
create table challenges (
  id             uuid primary key default gen_random_uuid(),
  file_id        uuid not null references files (id) on delete cascade,
  position       integer not null default 1 check (position > 0),
  prompt         text not null,
  answer_hash    text not null,
  answer_format  text not null default 'text' check (answer_format in ('text', 'numeric')),
  case_sensitive boolean not null default false,
  max_attempts   integer not null default 1 check (max_attempts between 1 and 10),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (file_id, position)
);

-- ---------------------------------------------------------------------
-- Submissions. The raw answer is stored encrypted; the digest is an HMAC
-- used for duplicate/abuse detection without ever decrypting the answer.
-- ---------------------------------------------------------------------
create table submissions (
  id                     uuid primary key default gen_random_uuid(),
  file_id                uuid not null references files (id),
  challenge_id           uuid not null references challenges (id),
  user_id                uuid not null references users (id),
  attempt_no             integer not null default 1 check (attempt_no > 0),
  wallet_address         text not null,
  answer_ciphertext      bytea not null,
  answer_digest          bytea not null,
  submitted_at           timestamptz not null default now(),
  status                 text not null default 'pending_review'
                         check (status in ('pending_review', 'correct', 'incorrect',
                                           'approved', 'rejected', 'rewarded')),
  holding_checked_at     timestamptz not null,
  holding_snapshot_f106  numeric(20, 8) not null,
  holding_required_f106  numeric(20, 8) not null,
  holding_satisfied      boolean not null,
  balance_slot           bigint,
  reviewed_by            uuid references admin_users (id),
  reviewed_at            timestamptz,
  admin_note             text,
  ip_hash                text,
  user_agent_hash        text,
  constraint submissions_unique_attempt unique (user_id, challenge_id, attempt_no),
  constraint submissions_holding_snapshot_non_negative check (holding_snapshot_f106 >= 0)
);

create index submissions_file_idx on submissions (file_id, status, submitted_at desc);
create index submissions_user_idx on submissions (user_id, submitted_at desc);
create index submissions_wallet_idx on submissions (wallet_address);

-- ---------------------------------------------------------------------
-- Winners
-- ---------------------------------------------------------------------
create table winners (
  id                 uuid primary key default gen_random_uuid(),
  file_id            uuid not null references files (id),
  submission_id      uuid not null unique references submissions (id),
  user_id            uuid not null references users (id),
  wallet_address     text not null,
  reward_amount_f106 numeric(20, 8) not null check (reward_amount_f106 > 0),
  status             text not null default 'selected'
                     check (status in ('selected', 'approved', 'rejected')),
  selected_by        uuid not null references admin_users (id),
  selected_at        timestamptz not null default now(),
  approved_by        uuid references admin_users (id),
  approved_at        timestamptz,
  -- A wallet can win a given file once, no matter how many accounts exist.
  constraint winners_wallet_per_file unique (file_id, wallet_address)
);

create index winners_user_idx on winners (user_id, selected_at desc);

-- ---------------------------------------------------------------------
-- Reward records. Payouts are manual: nobody's key is on the server.
-- ---------------------------------------------------------------------
create table rewards (
  id                       uuid primary key default gen_random_uuid(),
  reward_no                bigint generated always as identity unique,
  winner_id                uuid not null unique references winners (id),
  user_id                  uuid not null references users (id),
  wallet_address           text not null,
  file_id                  uuid not null references files (id),
  file_number              integer not null,
  amount_f106              numeric(20, 8) not null check (amount_f106 > 0),
  payment_status           text not null default 'awaiting_payment'
                           check (payment_status in ('awaiting_payment', 'payment_sent',
                                                     'confirmed', 'rejected')),
  approved_by              uuid not null references admin_users (id),
  approved_at              timestamptz not null default now(),
  confirmed_transaction_id uuid,
  confirmed_at             timestamptz,
  created_at               timestamptz not null default now(),
  constraint rewards_confirmed_requires_tx
    check (payment_status <> 'confirmed' or confirmed_transaction_id is not null)
);

create index rewards_status_idx on rewards (payment_status, approved_at desc);
create index rewards_user_idx on rewards (user_id, approved_at desc);

-- ---------------------------------------------------------------------
-- On-chain payment evidence. Append-only: a failed verification is a new
-- row, never an edit of a previous claim.
-- ---------------------------------------------------------------------
create table transactions (
  id                  uuid primary key default gen_random_uuid(),
  reward_id           uuid not null references rewards (id),
  signature           text not null unique,
  explorer_url        text not null,
  submitted_by        uuid not null references admin_users (id),
  submitted_at        timestamptz not null default now(),
  submitted_note      text,
  verification_status text not null default 'pending'
                      check (verification_status in ('pending', 'verified', 'failed')),
  verified_at         timestamptz,
  failure_reason      text,
  mint_address        text,
  from_address        text,
  to_address          text,
  amount_base_units   bigint,
  slot                bigint,
  block_time          timestamptz,
  rpc_response        jsonb,
  constraint transactions_signature_shape check (signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'),
  constraint transactions_amount_non_negative check (amount_base_units is null or amount_base_units >= 0)
);

create index transactions_reward_idx on transactions (reward_id, submitted_at desc);

alter table rewards
  add constraint rewards_confirmed_transaction_fk
  foreign key (confirmed_transaction_id) references transactions (id);

-- One transaction can confirm at most one reward.
create unique index rewards_confirmed_transaction_key
  on rewards (confirmed_transaction_id) where confirmed_transaction_id is not null;

-- ---------------------------------------------------------------------
-- Partnerships
-- ---------------------------------------------------------------------
create table partnerships (
  id                uuid primary key default gen_random_uuid(),
  partner_name      text not null unique,
  logo_url          text,
  x_username        text,
  x_url             text,
  telegram_username text,
  telegram_url      text,
  created_by        uuid references admin_users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table partnership_campaigns (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique,
  title              text not null,
  partnership_id     uuid references partnerships (id),
  file_id            uuid references files (id),
  description        text not null,
  rules_md           text,
  reward_amount_f106 numeric(20, 8) not null default 0,
  min_holding_f106   numeric(20, 8) not null default 1,
  winners_count      integer,
  status             text not null default 'draft'
                     check (status in ('draft', 'scheduled', 'active', 'paused', 'closed', 'archived')),
  starts_at          timestamptz,
  ends_at            timestamptz,
  paused_at          timestamptz,
  paused_reason      text,
  created_by         uuid references admin_users (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint campaigns_reward_non_negative check (reward_amount_f106 >= 0),
  constraint campaigns_min_holding_non_negative check (min_holding_f106 >= 0),
  constraint campaigns_winners_positive check (winners_count is null or winners_count > 0),
  constraint campaigns_window_order check (ends_at is null or starts_at is null or ends_at > starts_at),
  constraint campaigns_slug_shape check (slug ~ '^[a-z0-9-]{1,80}$')
);

create index campaigns_status_idx on partnership_campaigns (status, starts_at);

-- ---------------------------------------------------------------------
-- Campaign requirements. verification_mode decides whether the app can
-- prove the task automatically or must fall back to admin review.
-- ---------------------------------------------------------------------
create table campaign_tasks (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references partnership_campaigns (id) on delete cascade,
  kind              text not null
                    check (kind in ('x_follow', 'telegram_join', 'solana_hold',
                                    'archive_solve', 'custom')),
  label             text not null,
  target            text not null,
  target_url        text,
  verification_mode text not null default 'manual'
                    check (verification_mode in ('auto', 'manual')),
  is_required       boolean not null default true,
  position          integer not null default 1,
  created_by        uuid references admin_users (id),
  created_at        timestamptz not null default now(),
  unique (campaign_id, kind, target)
);

-- ---------------------------------------------------------------------
-- Social verification. A row can only reach 'verified' with a real check
-- timestamp, so a green check can never be produced by clicking a button.
-- ---------------------------------------------------------------------
create table social_verifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users (id) on delete cascade,
  campaign_id   uuid not null references partnership_campaigns (id) on delete cascade,
  task_id       uuid not null references campaign_tasks (id) on delete cascade,
  method        text not null check (method in ('x_oauth', 'telegram_bot', 'manual_review')),
  status        text not null default 'unverified'
                check (status in ('unverified', 'pending', 'verified', 'rejected', 'unavailable')),
  evidence      text,
  provider_ref  text,
  checked_at    timestamptz,
  reviewed_by   uuid references admin_users (id),
  reviewed_at   timestamptz,
  reviewer_note text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, task_id),
  constraint social_verified_needs_check check (status <> 'verified' or checked_at is not null),
  constraint social_reviewed_needs_reviewer check (
    status not in ('verified', 'rejected') or method <> 'manual_review' or reviewed_by is not null
  )
);

create index social_verifications_campaign_idx on social_verifications (campaign_id, status);

-- ---------------------------------------------------------------------
-- Per-user campaign state, denormalised so the UI can render the
-- 17-step journey without aggregating in the browser.
-- ---------------------------------------------------------------------
create table user_campaign_progress (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users (id) on delete cascade,
  campaign_id           uuid not null references partnership_campaigns (id) on delete cascade,
  registered_at         timestamptz,
  wallet_connected_at   timestamptz,
  balance_verified_at   timestamptz,
  balance_snapshot_f106 numeric(20, 8),
  tasks_required        integer not null default 0 check (tasks_required >= 0),
  tasks_verified        integer not null default 0 check (tasks_verified >= 0),
  is_eligible           boolean not null default false,
  eligible_at           timestamptz,
  submission_id         uuid references submissions (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id, campaign_id),
  constraint progress_verified_within_required check (tasks_verified <= tasks_required),
  constraint progress_eligible_needs_timestamp check (not is_eligible or eligible_at is not null)
);

-- ---------------------------------------------------------------------
-- Audit trail. Append-only by trigger.
-- ---------------------------------------------------------------------
create table admin_audit_logs (
  id           bigint generated always as identity primary key,
  admin_id     uuid references admin_users (id),
  action       text not null,
  entity       text not null,
  entity_id    text,
  before_state jsonb,
  after_state  jsonb,
  ip_hash      text,
  created_at   timestamptz not null default now()
);

create index admin_audit_logs_entity_idx on admin_audit_logs (entity, entity_id, created_at desc);
create index admin_audit_logs_admin_idx on admin_audit_logs (admin_id, created_at desc);

-- =====================================================================
-- Triggers
-- =====================================================================

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger admin_users_set_updated_at before update on admin_users
  for each row execute function set_updated_at();
create trigger users_set_updated_at before update on users
  for each row execute function set_updated_at();
create trigger files_set_updated_at before update on files
  for each row execute function set_updated_at();
create trigger challenges_set_updated_at before update on challenges
  for each row execute function set_updated_at();
create trigger partnerships_set_updated_at before update on partnerships
  for each row execute function set_updated_at();
create trigger campaigns_set_updated_at before update on partnership_campaigns
  for each row execute function set_updated_at();
create trigger social_verifications_set_updated_at before update on social_verifications
  for each row execute function set_updated_at();
create trigger progress_set_updated_at before update on user_campaign_progress
  for each row execute function set_updated_at();

-- Sealed tables: no rewrites, no deletions.
create or replace function reject_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only: % is not permitted', tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

create trigger transactions_append_only
  before update or delete on transactions
  for each row execute function reject_mutation();

create trigger admin_audit_logs_append_only
  before update or delete on admin_audit_logs
  for each row execute function reject_mutation();

-- Rewards may move through payment statuses, but the money facts and the
-- confirmation link are frozen. Deleting a reward is never allowed.
create or replace function rewards_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'reward records cannot be deleted (reward %)', old.id
      using errcode = 'restrict_violation';
  end if;

  if new.winner_id          <> old.winner_id
     or new.user_id         <> old.user_id
     or new.wallet_address  <> old.wallet_address
     or new.file_id         <> old.file_id
     or new.file_number     <> old.file_number
     or new.amount_f106     <> old.amount_f106
     or new.approved_by     <> old.approved_by
     or new.approved_at     <> old.approved_at then
    raise exception 'reward money and attribution fields are immutable (reward %)', old.id
      using errcode = 'restrict_violation';
  end if;

  if old.payment_status = 'confirmed' and new.payment_status <> 'confirmed' then
    raise exception 'a confirmed reward cannot leave the confirmed state (reward %)', old.id
      using errcode = 'restrict_violation';
  end if;

  if old.confirmed_transaction_id is not null
     and new.confirmed_transaction_id is distinct from old.confirmed_transaction_id then
    raise exception 'reward % is already confirmed by transaction %',
      old.id, old.confirmed_transaction_id
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger rewards_guard
  before update or delete on rewards
  for each row execute function rewards_guard();

-- A puzzle answer cannot be changed once someone has submitted against it.
create or replace function challenges_guard() returns trigger
language plpgsql as $$
begin
  if new.answer_hash is distinct from old.answer_hash
     and exists (select 1 from submissions where challenge_id = old.id) then
    raise exception 'answer_hash cannot change after the first submission (challenge %)', old.id
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger challenges_guard
  before update on challenges
  for each row execute function challenges_guard();

-- =====================================================================
-- Read views (public transparency + admin analytics)
-- =====================================================================

create view v_public_winners as
select
  f.file_number,
  f.title             as file_title,
  u.username,
  w.reward_amount_f106 as reward_f106,
  w.approved_at,
  r.payment_status,
  r.confirmed_at,
  tx.signature,
  tx.explorer_url
from winners w
join files f            on f.id = w.file_id
join users u            on u.id = w.user_id
join rewards r          on r.winner_id = w.id
left join transactions tx on tx.id = r.confirmed_transaction_id
where w.status = 'approved';

create view v_file_stats as
select
  f.id,
  f.file_number,
  f.title,
  f.status,
  (select count(*) from submissions s where s.file_id = f.id) as submissions_total,
  (select count(*) from submissions s
     where s.file_id = f.id and s.status in ('correct', 'approved', 'rewarded')) as correct_total,
  (select count(*) from winners w where w.file_id = f.id and w.status = 'approved') as winners_total,
  (select count(*) from rewards r
     where r.file_id = f.id and r.payment_status <> 'confirmed') as pending_rewards,
  (select coalesce(sum(r.amount_f106), 0) from rewards r
     where r.file_id = f.id and r.payment_status = 'confirmed') as distributed_f106
from files f;

create view v_campaign_stats as
select
  c.id,
  c.slug,
  c.title,
  c.status,
  (select count(*) from user_campaign_progress p where p.campaign_id = c.id) as participants,
  (select count(*) from user_campaign_progress p
     where p.campaign_id = c.id and p.wallet_connected_at is not null) as wallets_connected,
  (select count(*) from social_verifications v
     where v.campaign_id = c.id and v.status = 'verified') as social_verified,
  (select count(*) from user_campaign_progress p
     where p.campaign_id = c.id and p.is_eligible) as eligible,
  (select count(*) from campaign_tasks t
     where t.campaign_id = c.id and t.is_required) as required_tasks,
  case when c.file_id is null then 0
       else (select count(*) from submissions s where s.file_id = c.file_id) end as puzzle_submissions,
  case when c.file_id is null then 0
       else (select count(*) from winners w where w.file_id = c.file_id and w.status = 'approved') end as winners_approved,
  case when c.file_id is null then 0
       else (select coalesce(sum(r.amount_f106), 0) from rewards r
              where r.file_id = c.file_id and r.payment_status = 'confirmed') end as distributed_f106
from partnership_campaigns c;

-- =====================================================================
-- Baselines every deployment should ship with
-- =====================================================================
insert into settings (key, value, description) values
  ('reward.min_holding_f106',      '1',    'Default F106 holding required to open a file'),
  ('reward.default_amount_f106',   '0',    'Fallback reward when an admin leaves it blank'),
  ('social.x_oauth_enabled',       'false','X follow verification requires paid X API access'),
  ('social.telegram_bot_enabled',  'false','Telegram membership verification requires a bot in the group'),
  ('security.max_login_attempts',  '8',    'Failed logins per address before a cool-down'),
  ('security.session_ttl_hours',   '168',  'Participant session lifetime'),
  ('security.admin_session_ttl_hours', '12','Admin session lifetime'),
  ('platform.maintenance_mode',    'false','When true, participants see a maintenance notice')
on conflict (key) do nothing;

commit;
