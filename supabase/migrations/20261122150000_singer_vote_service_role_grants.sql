-- Fix voting API 503: private tables lacked grants for Supabase Edge Function service_role.
-- Anon/authenticated retain no direct access to votes or administrative data.
grant select, insert, update, delete on public.singer_vote_sessions to service_role;
grant select, insert, update, delete on public.singer_vote_ballots to service_role;
grant select, insert, update, delete on public.singer_vote_rate to service_role;
grant select on public.singer_vote_admin to service_role;
