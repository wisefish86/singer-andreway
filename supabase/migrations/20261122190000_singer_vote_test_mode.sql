-- Test voting is isolated in its own session, never mixed with real results.
-- Existing sessions remain normal voting by default.
alter table public.singer_vote_sessions
 add column if not exists test_mode boolean not null default false;
