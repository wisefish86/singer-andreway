-- Allow 1–3 different songs per ballot, retaining upsert semantics:
-- each visitor has ONE ballot per event and a later submission replaces it.
create or replace function public.singer_cast_vote(
 p_session uuid, p_voter_hash text, p_ip_hash text, p_song_ids text[]
) returns text language plpgsql security invoker set search_path = public as $$
declare active boolean; accepted integer;
begin
 select enabled and starts_at <= now() and ends_at > now() into active
 from singer_vote_sessions where id = p_session for share;
 if not coalesce(active,false) then return 'closed'; end if;
 if cardinality(p_song_ids) not between 1 and 3 or
    (select count(distinct x) from unnest(p_song_ids) x) <> cardinality(p_song_ids) then return 'invalid'; end if;
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
