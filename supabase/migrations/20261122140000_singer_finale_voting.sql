-- Finale song voting v1. Apply to singer Supabase project only after review.
-- Public roles have no direct table access; all operations go through singer-vote Edge Function.
create table if not exists public.singer_vote_sessions (
 id uuid primary key default gen_random_uuid(),
 title text not null default 'Голосование вечера',
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 enabled boolean not null default false,
 created_at timestamptz not null default now(),
 constraint singer_vote_session_times check (ends_at > starts_at and ends_at <= starts_at + interval '12 hours')
);
create table if not exists public.singer_vote_ballots (
 session_id uuid not null references public.singer_vote_sessions(id) on delete cascade,
 voter_hash text not null,
 song_ids text[] not null,
 updated_at timestamptz not null default now(),
 primary key (session_id, voter_hash),
 constraint singer_vote_ballot_size check (cardinality(song_ids) between 1 and 3)
);
create table if not exists public.singer_vote_rate (
 session_id uuid not null references public.singer_vote_sessions(id) on delete cascade,
 ip_hash text not null,
 bucket timestamptz not null,
 attempts integer not null default 0,
 primary key(session_id,ip_hash,bucket)
);
alter table public.singer_vote_sessions enable row level security;
alter table public.singer_vote_ballots enable row level security;
alter table public.singer_vote_rate enable row level security;
revoke all on public.singer_vote_sessions, public.singer_vote_ballots, public.singer_vote_rate from anon, authenticated;
-- Privileged transaction prevents races between simultaneous submissions.
create or replace function public.singer_cast_vote(
 p_session uuid, p_voter_hash text, p_ip_hash text, p_song_ids text[]
) returns text language plpgsql security invoker set search_path = public as $$
declare active boolean; accepted integer;
begin
 select enabled and starts_at <= now() and ends_at > now() into active
 from singer_vote_sessions where id = p_session for share;
 if not coalesce(active,false) then return 'closed'; end if;
 if cardinality(p_song_ids) <> 3 or
    (select count(distinct x) from unnest(p_song_ids) x) <> 3 then return 'invalid'; end if;
 insert into singer_vote_rate(session_id,ip_hash,bucket,attempts)
 values(p_session,p_ip_hash,date_trunc('hour',now()),1)
 on conflict(session_id,ip_hash,bucket)
 do update set attempts = singer_vote_rate.attempts + 1
 where singer_vote_rate.attempts < 60
 returning attempts into accepted;
 if accepted is null then return 'rate_limited'; end if;
 insert into singer_vote_ballots(session_id,voter_hash,song_ids)
 values (p_session,p_voter_hash,p_song_ids)
 on conflict(session_id,voter_hash)
 do update set song_ids = excluded.song_ids, updated_at = now();
 return 'ok';
end $$;
revoke all on function public.singer_cast_vote(uuid,text,text,text[]) from public, anon, authenticated;
grant execute on function public.singer_cast_vote(uuid,text,text,text[]) to service_role;
