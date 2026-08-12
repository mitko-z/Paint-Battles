-- Drawing-Battle initial schema, RLS, and game RPCs

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  is_guest boolean not null default true,
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  created_at timestamptz not null default now()
);

create table public.prompts (
  id uuid primary key default gen_random_uuid(),
  text text not null unique,
  difficulty text not null default 'easy' check (difficulty in ('easy', 'medium', 'hard')),
  created_at timestamptz not null default now()
);

create type public.room_status as enum ('waiting', 'matched', 'closed');
create type public.match_status as enum (
  'waiting',
  'countdown',
  'drawing',
  'submitting',
  'judging',
  'results',
  'cancelled'
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_id uuid not null references public.profiles (id) on delete cascade,
  guest_id uuid references public.profiles (id) on delete set null,
  status public.room_status not null default 'waiting',
  created_at timestamptz not null default now()
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.rooms (id) on delete set null,
  player_a uuid not null references public.profiles (id) on delete cascade,
  player_b uuid not null references public.profiles (id) on delete cascade,
  prompt text not null,
  status public.match_status not null default 'countdown',
  countdown_ends_at timestamptz,
  drawing_ends_at timestamptz,
  submit_deadline_at timestamptz,
  winner_id uuid references public.profiles (id) on delete set null,
  is_draw boolean not null default false,
  judge_latency_ms integer,
  created_at timestamptz not null default now(),
  check (player_a <> player_b)
);

create table public.match_submissions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  storage_path text not null,
  score numeric(5, 2),
  rationale text,
  submitted_at timestamptz not null default now(),
  unique (match_id, user_id)
);

create table public.matchmaking_queue (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now()
);

create index matches_player_a_idx on public.matches (player_a);
create index matches_player_b_idx on public.matches (player_b);
create index matches_status_idx on public.matches (status);
create index rooms_code_idx on public.rooms (code);
create index matchmaking_queue_joined_at_idx on public.matchmaking_queue (joined_at);

-- ---------------------------------------------------------------------------
-- Seed prompts (easy doodles for AI judging)
-- ---------------------------------------------------------------------------

insert into public.prompts (text, difficulty) values
  ('cat', 'easy'),
  ('house', 'easy'),
  ('tree', 'easy'),
  ('sun', 'easy'),
  ('fish', 'easy'),
  ('car', 'easy'),
  ('apple', 'easy'),
  ('dog', 'easy'),
  ('flower', 'easy'),
  ('boat', 'easy'),
  ('pizza', 'medium'),
  ('bicycle', 'medium'),
  ('umbrella', 'medium'),
  ('rocket', 'medium'),
  ('dinosaur', 'hard');

-- ---------------------------------------------------------------------------
-- Storage bucket for drawings
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'drawings',
  'drawings',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.generate_room_code()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i integer;
begin
  for i in 1..6 loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end;
$$;

create or replace function public.random_prompt()
returns text
language sql
stable
as $$
  select text from public.prompts order by random() limit 1;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  guest_name text;
begin
  guest_name := coalesce(
    new.raw_user_meta_data->>'display_name',
    'Guest-' || substr(replace(new.id::text, '-', ''), 1, 6)
  );
  insert into public.profiles (id, display_name, is_guest)
  values (
    new.id,
    guest_name,
    coalesce((new.raw_user_meta_data->>'is_guest')::boolean, true)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_match_player(mid uuid, uid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.matches m
    where m.id = mid and (m.player_a = uid or m.player_b = uid)
  );
$$;

create or replace function public.active_match_for(uid uuid)
returns uuid
language sql
stable
as $$
  select m.id
  from public.matches m
  where (m.player_a = uid or m.player_b = uid)
    and m.status in ('waiting', 'countdown', 'drawing', 'submitting', 'judging')
  order by m.created_at desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

create or replace function public.create_room()
returns public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  new_room public.rooms;
  code text;
  tries integer := 0;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if public.active_match_for(uid) is not null then
    raise exception 'Already in an active match';
  end if;

  delete from public.matchmaking_queue where user_id = uid;
  update public.rooms
    set status = 'closed'
    where host_id = uid and status = 'waiting';

  loop
    tries := tries + 1;
    code := public.generate_room_code();
    begin
      insert into public.rooms (code, host_id)
      values (code, uid)
      returning * into new_room;
      exit;
    exception when unique_violation then
      if tries > 10 then
        raise exception 'Could not allocate room code';
      end if;
    end;
  end loop;

  return new_room;
end;
$$;

create or replace function public.join_room(p_code text)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  room public.rooms;
  new_match public.matches;
  chosen_prompt text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if public.active_match_for(uid) is not null then
    raise exception 'Already in an active match';
  end if;

  select * into room
  from public.rooms
  where code = upper(trim(p_code))
    and status = 'waiting'
  for update;

  if room is null then
    raise exception 'Room not found or already started';
  end if;

  if room.host_id = uid then
    raise exception 'Cannot join your own room';
  end if;

  if room.guest_id is not null then
    raise exception 'Room is full';
  end if;

  delete from public.matchmaking_queue where user_id = uid;
  chosen_prompt := public.random_prompt();

  update public.rooms
  set guest_id = uid, status = 'matched'
  where id = room.id;

  insert into public.matches (
    room_id, player_a, player_b, prompt, status, countdown_ends_at
  ) values (
    room.id,
    room.host_id,
    uid,
    chosen_prompt,
    'countdown',
    now() + interval '3 seconds'
  )
  returning * into new_match;

  return new_match;
end;
$$;

create or replace function public.join_queue()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  opponent uuid;
  new_match public.matches;
  chosen_prompt text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if public.active_match_for(uid) is not null then
    raise exception 'Already in an active match';
  end if;

  -- Pair with oldest waiter who is not self
  select q.user_id into opponent
  from public.matchmaking_queue q
  where q.user_id <> uid
    and q.joined_at > now() - interval '5 minutes'
  order by q.joined_at asc
  limit 1
  for update skip locked;

  if opponent is not null then
    delete from public.matchmaking_queue where user_id in (uid, opponent);
    chosen_prompt := public.random_prompt();

    insert into public.matches (
      player_a, player_b, prompt, status, countdown_ends_at
    ) values (
      opponent,
      uid,
      chosen_prompt,
      'countdown',
      now() + interval '3 seconds'
    )
    returning * into new_match;

    return jsonb_build_object('matched', true, 'match', to_jsonb(new_match));
  end if;

  insert into public.matchmaking_queue (user_id, joined_at)
  values (uid, now())
  on conflict (user_id) do update set joined_at = excluded.joined_at;

  return jsonb_build_object('matched', false, 'queued', true);
end;
$$;

create or replace function public.leave_queue()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.matchmaking_queue where user_id = auth.uid();
end;
$$;

create or replace function public.leave_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  update public.rooms
  set status = 'closed'
  where id = p_room_id
    and host_id = uid
    and status = 'waiting';
end;
$$;

create or replace function public.advance_match_phases()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- countdown -> drawing
  update public.matches
  set
    status = 'drawing',
    drawing_ends_at = now() + interval '60 seconds',
    submit_deadline_at = now() + interval '75 seconds'
  where status = 'countdown'
    and countdown_ends_at is not null
    and countdown_ends_at <= now();

  -- drawing -> submitting when timer ends
  update public.matches
  set status = 'submitting'
  where status = 'drawing'
    and drawing_ends_at is not null
    and drawing_ends_at <= now();
end;
$$;

create or replace function public.submit_drawing(p_match_id uuid, p_storage_path text)
returns public.match_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  submission public.match_submissions;
  submission_count integer;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  perform public.advance_match_phases();

  select * into m from public.matches where id = p_match_id for update;
  if m is null then
    raise exception 'Match not found';
  end if;

  if m.player_a <> uid and m.player_b <> uid then
    raise exception 'Not a player in this match';
  end if;

  if m.status not in ('drawing', 'submitting') then
    raise exception 'Match is not accepting submissions';
  end if;

  if m.submit_deadline_at is not null and now() > m.submit_deadline_at then
    raise exception 'Submission deadline passed';
  end if;

  -- Early submit keeps status as drawing so the opponent can keep drawing
  -- until they submit or the shared timer ends (advance_match_phases).

  insert into public.match_submissions (match_id, user_id, storage_path)
  values (p_match_id, uid, p_storage_path)
  on conflict (match_id, user_id) do update
    set storage_path = excluded.storage_path,
        submitted_at = now()
  returning * into submission;

  select count(*) into submission_count
  from public.match_submissions
  where match_id = p_match_id;

  -- Both finished (early or after timeout) → judging
  if submission_count >= 2 then
    update public.matches
    set status = 'judging'
    where id = p_match_id
      and status in ('drawing', 'submitting');
  end if;

  return submission;
end;
$$;

create or replace function public.get_my_active_match()
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.matches;
begin
  perform public.advance_match_phases();
  select * into m
  from public.matches
  where (player_a = uid or player_b = uid)
    and status in ('waiting', 'countdown', 'drawing', 'submitting', 'judging', 'results')
  order by created_at desc
  limit 1;
  -- Avoid returning a null-filled composite row (PostgREST serializes that as an object)
  if m.id is null then
    return null;
  end if;
  return m;
end;
$$;

create or replace function public.list_recent_matches(limit_count integer default 10)
returns setof public.matches
language sql
security definer
set search_path = public
as $$
  select *
  from public.matches
  where (player_a = auth.uid() or player_b = auth.uid())
    and status = 'results'
  order by created_at desc
  limit greatest(1, least(limit_count, 50));
$$;

create or replace function public.upgrade_profile(p_display_name text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  updated public.profiles;
begin
  update public.profiles
  set
    display_name = coalesce(nullif(trim(p_display_name), ''), display_name),
    is_guest = false
  where id = auth.uid()
  returning * into updated;
  return updated;
end;
$$;

create or replace function public.cleanup_stale()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.matchmaking_queue
  where joined_at < now() - interval '10 minutes';

  update public.rooms
  set status = 'closed'
  where status = 'waiting'
    and created_at < now() - interval '30 minutes';

  update public.matches
  set status = 'cancelled'
  where status in ('countdown', 'drawing', 'submitting', 'judging')
    and created_at < now() - interval '15 minutes';
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.prompts enable row level security;
alter table public.rooms enable row level security;
alter table public.matches enable row level security;
alter table public.match_submissions enable row level security;
alter table public.matchmaking_queue enable row level security;

create policy "Profiles are readable by authenticated users"
  on public.profiles for select to authenticated
  using (true);

create policy "Users can update own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "Prompts readable"
  on public.prompts for select to authenticated
  using (true);

create policy "Rooms readable by participants"
  on public.rooms for select to authenticated
  using (host_id = auth.uid() or guest_id = auth.uid() or status = 'waiting');

create policy "Matches readable by players"
  on public.matches for select to authenticated
  using (player_a = auth.uid() or player_b = auth.uid());

create policy "Submissions readable by match players"
  on public.match_submissions for select to authenticated
  using (public.is_match_player(match_id, auth.uid()));

create policy "Queue readable own row"
  on public.matchmaking_queue for select to authenticated
  using (user_id = auth.uid());

create policy "Drawings: players can upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'drawings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Drawings: public read"
  on storage.objects for select to public
  using (bucket_id = 'drawings');

create policy "Drawings: owners can update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'drawings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Realtime
alter publication supabase_realtime add table public.matches;
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.match_submissions;
alter publication supabase_realtime add table public.matchmaking_queue;

grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant select on public.prompts to authenticated;
grant select on public.rooms to authenticated;
grant select on public.matches to authenticated;
grant select on public.match_submissions to authenticated;
grant select on public.matchmaking_queue to authenticated;

grant execute on function public.create_room() to authenticated;
grant execute on function public.join_room(text) to authenticated;
grant execute on function public.join_queue() to authenticated;
grant execute on function public.leave_queue() to authenticated;
grant execute on function public.leave_room(uuid) to authenticated;
grant execute on function public.submit_drawing(uuid, text) to authenticated;
grant execute on function public.get_my_active_match() to authenticated;
grant execute on function public.list_recent_matches(integer) to authenticated;
grant execute on function public.upgrade_profile(text) to authenticated;
grant execute on function public.advance_match_phases() to authenticated;
