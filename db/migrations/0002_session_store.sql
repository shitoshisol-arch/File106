-- =====================================================================
-- FILE106 ARCHIVE — Migration 0002: durable session store
--
-- @fastify/session needs somewhere to persist session state. The sessions
-- table already exists for revocation and audit; this adds the serialized
-- session payload and allows anonymous sessions (a visitor who has not signed
-- in still needs a CSRF token before any account exists).
--
-- Apply: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0002_session_store.sql
-- =====================================================================

begin;

alter table sessions
  add column if not exists data jsonb;

-- 0 or 1 principal: anonymous sessions are legitimate, and a session must
-- still never belong to a participant and an admin at the same time.
alter table sessions drop constraint if exists sessions_one_principal;
alter table sessions
  add constraint sessions_one_principal check (num_nonnulls(user_id, admin_id) <= 1);

-- Session lookups happen on every request; expiry sweeps happen on a timer.
create index if not exists sessions_expiry_idx on sessions (expires_at);

commit;
