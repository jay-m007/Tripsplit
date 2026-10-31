-- Trip Split database. Paste into Supabase: SQL Editor > New query > Run.
-- The server only ever sees encrypted events. People join with an invite link and an anonymous sign-in.

create table if not exists public.trips (
  id uuid primary key,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.trip_members (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null,
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create table if not exists public.events (
  id bigint generated always as identity primary key,
  trip_id uuid not null references public.trips(id) on delete cascade,
  iv text not null check (length(iv) between 12 and 24),
  ct text not null check (length(ct) between 16 and 24000),
  author uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists events_trip_idx on public.events (trip_id, id);

alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.events enable row level security;

-- Is the signed-in user part of this trip? Lives in a private schema so it is not callable through the API.
create schema if not exists private;
grant usage on schema private to authenticated;
create or replace function private.is_member(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.trip_members m where m.trip_id = t and m.user_id = auth.uid());
$$;

-- Start a trip: creates it and adds the creator.
create or replace function public.create_trip(t uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if (select count(*) from public.trips where created_by = auth.uid() and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many new trips. Try again later.';
  end if;
  insert into public.trips (id, created_by) values (t, auth.uid());
  insert into public.trip_members (trip_id, user_id) values (t, auth.uid());
end $$;

-- Join with an invite link. Returns false when there is no such trip.
create or replace function public.join_trip(t uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from public.trips where id = t) then return false; end if;
  insert into public.trip_members (trip_id, user_id) values (t, auth.uid()) on conflict do nothing;
  return true;
end $$;

-- Keep any one trip to a sane size.
create or replace function public.events_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.events where trip_id = new.trip_id) >= 5000 then
    raise exception 'This trip is full (5000 changes).';
  end if;
  return new;
end $$;
drop trigger if exists events_limit on public.events;
create trigger events_limit before insert on public.events for each row execute function public.events_limit();

revoke execute on function private.is_member(uuid), public.create_trip(uuid), public.join_trip(uuid), public.events_limit() from public, anon;
revoke execute on function public.events_limit() from authenticated;
grant execute on function private.is_member(uuid), public.create_trip(uuid), public.join_trip(uuid) to authenticated;

-- Members can read and add events of their trips. Nobody can change or delete an event.
drop policy if exists "members read events" on public.events;
create policy "members read events" on public.events for select to authenticated using (private.is_member(trip_id));
drop policy if exists "members add events" on public.events;
create policy "members add events" on public.events for insert to authenticated with check (private.is_member(trip_id) and author = auth.uid());
drop policy if exists "see own memberships" on public.trip_members;
create policy "see own memberships" on public.trip_members for select to authenticated using (user_id = auth.uid());
drop policy if exists "members see trip" on public.trips;
create policy "members see trip" on public.trips for select to authenticated using (private.is_member(id));

-- Live updates.
do $$ begin
  alter publication supabase_realtime add table public.events;
exception when duplicate_object then null; end $$;
