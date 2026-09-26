-- Tigris & Euphrates Online: rooms and seat presence.
--
-- Browsers never touch these tables. The Vercel functions call the te_* functions below with the
-- secret (service_role) key. RLS is enabled without policies and anon/authenticated have no grants,
-- so the publishable key that the page ships cannot read hands, scores or seat tokens.

create table if not exists public.te_rooms (
  code        text primary key check (code ~ '^[A-Z0-9]{6}$'),
  rev         bigint not null default 1,          -- bumped by every save: optimistic concurrency
  phase       text not null default 'lobby' check (phase in ('lobby', 'play', 'over')),
  data        jsonb not null,                     -- seats (with token hashes) and the full game state
  creator     text,                               -- keyed hash of the creator's IP, for the creation limit
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists te_rooms_updated_at_idx on public.te_rooms (updated_at);
create index if not exists te_rooms_creator_idx on public.te_rooms (creator, created_at) where creator is not null;

-- When each seat last called the API: a seat is "online" while its page keeps polling.
create table if not exists public.te_presence (
  code        text not null references public.te_rooms (code) on delete cascade,
  token_hash  text not null,
  last_seen   timestamptz not null default now(),
  primary key (code, token_hash)
);

alter table public.te_rooms enable row level security;
alter table public.te_presence enable row level security;
revoke all on table public.te_rooms, public.te_presence from anon, authenticated;
grant select, insert, update, delete on table public.te_rooms, public.te_presence to service_role;

-- token_hash -> last_seen in epoch milliseconds, for one room.
create or replace function public.te_seen(p_code text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(token_hash, floor(extract(epoch from last_seen) * 1000)::bigint), '{}'::jsonb)
  from public.te_presence
  where code = p_code
$$;

-- Reads a room and records that the seat with p_token_hash is here.
-- The room data is returned only when it is newer than p_have, the revision the caller already holds.
-- Returns null when there is no such room.
create or replace function public.te_sync(p_code text, p_token_hash text, p_have bigint)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_rev bigint;
  v_data jsonb;
  v_seated boolean := false;
begin
  -- KEY SHARE keeps the room from being deleted meanwhile and does not block saves.
  select r.rev, r.data into v_rev, v_data
  from public.te_rooms r
  where r.code = p_code
  for key share;
  if not found then
    return null;
  end if;

  if p_token_hash is not null then
    v_seated := exists (
      select 1 from jsonb_array_elements(v_data -> 'seats') s where s ->> 'tokenHash' = p_token_hash
    );
    if v_seated then
      insert into public.te_presence (code, token_hash, last_seen)
      values (p_code, p_token_hash, now())
      on conflict (code, token_hash) do update set last_seen = excluded.last_seen;
    end if;
  end if;

  return jsonb_build_object(
    'rev', v_rev,
    'seated', v_seated,
    'now', floor(extract(epoch from now()) * 1000)::bigint,
    'seen', public.te_seen(p_code),
    'data', case when v_rev > coalesce(p_have, 0) then v_data end
  );
end
$$;

-- Creates a room with its first seat. Returns 'ok', 'duplicate' (the code is taken) or 'limited'
-- (this creator already made p_limit rooms in the last p_window_s seconds).
create or replace function public.te_create(
  p_code text, p_data jsonb, p_token_hash text, p_creator text, p_limit integer, p_window_s integer
)
returns text
language plpgsql
set search_path = ''
as $$
begin
  if p_creator is not null and coalesce(p_limit, 0) > 0 and (
    select count(*) from public.te_rooms
    where creator = p_creator and created_at > now() - make_interval(secs => p_window_s)
  ) >= p_limit then
    return 'limited';
  end if;
  insert into public.te_rooms (code, data, creator) values (p_code, p_data, p_creator);
  insert into public.te_presence (code, token_hash) values (p_code, p_token_hash);
  return 'ok';
exception
  when unique_violation then
    return 'duplicate';
end
$$;

-- Saves a room if nobody saved it since revision p_rev. Returns the new revision, or null on a conflict.
create or replace function public.te_save(p_code text, p_rev bigint, p_data jsonb, p_phase text, p_token_hash text)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_rev bigint;
begin
  update public.te_rooms
  set data = p_data, phase = p_phase, rev = rev + 1, updated_at = now()
  where code = p_code and rev = p_rev
  returning rev into v_rev;
  if v_rev is not null and p_token_hash is not null then
    insert into public.te_presence (code, token_hash, last_seen)
    values (p_code, p_token_hash, now())
    on conflict (code, token_hash) do update set last_seen = excluded.last_seen;
  end if;
  return v_rev;
end
$$;

-- Deletes a room if it is still at revision p_rev.
create or replace function public.te_delete(p_code text, p_rev bigint)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  delete from public.te_rooms where code = p_code and rev = p_rev;
  return found;
end
$$;

-- Marks a seat as gone right now, as if it had been silent for p_offline_s seconds.
create or replace function public.te_away(p_code text, p_token_hash text, p_offline_s integer)
returns void
language sql
set search_path = ''
as $$
  update public.te_presence
  set last_seen = least(last_seen, now() - make_interval(secs => p_offline_s))
  where code = p_code and token_hash = p_token_hash
$$;

-- Removes abandoned rooms: lobbies idle for 6 hours, finished games after 2 days, anything after 14 days.
create or replace function public.te_cleanup()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.te_rooms
  where (phase = 'lobby' and updated_at < now() - interval '6 hours')
     or (phase = 'over' and updated_at < now() - interval '2 days')
     or updated_at < now() - interval '14 days';
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- Only the server (service_role) may call these; Supabase grants new functions to anon by default.
revoke all on function public.te_seen(text) from public, anon, authenticated;
revoke all on function public.te_sync(text, text, bigint) from public, anon, authenticated;
revoke all on function public.te_create(text, jsonb, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.te_save(text, bigint, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.te_delete(text, bigint) from public, anon, authenticated;
revoke all on function public.te_away(text, text, integer) from public, anon, authenticated;
revoke all on function public.te_cleanup() from public, anon, authenticated;

grant execute on function public.te_seen(text) to service_role;
grant execute on function public.te_sync(text, text, bigint) to service_role;
grant execute on function public.te_create(text, jsonb, text, text, integer, integer) to service_role;
grant execute on function public.te_save(text, bigint, jsonb, text, text) to service_role;
grant execute on function public.te_delete(text, bigint) to service_role;
grant execute on function public.te_away(text, text, integer) to service_role;
grant execute on function public.te_cleanup() to service_role;
