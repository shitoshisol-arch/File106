-- =====================================================================
-- FILE106 ARCHIVE — Migration 0003: session generation
--
-- @fastify/session v11 persists through compare-and-set: every stored session
-- carries a generation, and a write is only accepted when the caller's expected
-- generation still matches. That is what stops a pre-login cookie from being
-- promoted into an authenticated session, and what makes "sign in somewhere
-- else" invalidate the older copy.
--
-- The generation is opaque (the plugin generates it); text is the honest type.
--
-- Apply: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0003_session_generation.sql
-- =====================================================================

begin;

alter table sessions
  add column if not exists generation text;

-- Rows written before this migration have no generation and can never satisfy a
-- compare-and-set. Dropping them forces a clean re-issue instead of leaving a
-- session that silently fails to save on every request.
delete from sessions where generation is null;

alter table sessions
  alter column generation set not null;

commit;
