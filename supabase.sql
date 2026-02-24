-- Supabase schema for Rachao dos Crias
-- Enable UUID generation
create extension if not exists "pgcrypto";

-- Teams
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  created_at timestamptz not null default now()
);

-- Matches
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  date_iso text not null,
  mode text not null check (mode in ('quick', 'tournament')),
  team_a_id uuid references public.teams(id),
  team_b_id uuid references public.teams(id),
  team_a_name text not null,
  team_b_name text not null,
  quarters int not null,
  durations int[] not null,
  match_no int,
  status text not null check (status in ('pending', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_matches_date on public.matches(date_iso);
create index if not exists idx_matches_mode on public.matches(mode);
create index if not exists idx_matches_team_names on public.matches(team_a_name, team_b_name);

-- Match results
create table if not exists public.match_results (
  match_id uuid primary key references public.matches(id) on delete cascade,
  score_a int not null default 0,
  score_b int not null default 0,
  baskets1 int not null default 0,
  baskets2 int not null default 0,
  baskets3 int not null default 0,
  finished_at timestamptz not null default now()
);

-- Live game (single row)
create table if not exists public.live_game (
  id int primary key,
  status text not null check (status in ('running','paused','ended')),
  mode text not null check (mode in ('quick','tournament')),
  match_id uuid null references public.matches(id) on delete set null,
  match_no int null,
  quarter int not null default 1,
  time_left int not null default 0,
  team_a text not null,
  team_b text not null,
  score_a int not null default 0,
  score_b int not null default 0,
  updated_at timestamptz not null default now()
);

-- Pending invites for master role
create table if not exists public.pending_invites (
  email text primary key,
  role text not null check (role in ('master', 'observer')),
  created_at timestamptz not null default now()
);

-- Profiles / roles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text,
  is_active boolean not null default true,
  role text not null check (role in ('master', 'observer')),
  created_at timestamptz not null default now()
);

-- Updated_at trigger
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_matches_updated_at
before update on public.matches
for each row execute function public.set_updated_at();

-- RLS
alter table public.teams enable row level security;
alter table public.matches enable row level security;
alter table public.match_results enable row level security;
alter table public.live_game enable row level security;
alter table public.profiles enable row level security;
alter table public.pending_invites enable row level security;

-- Read policies (public read)
create policy "public read teams" on public.teams
  for select using (true);

create policy "public read matches" on public.matches
  for select using (true);

create policy "public read results" on public.match_results
  for select using (true);

create policy "public read live" on public.live_game
  for select using (true);

create policy "read profiles for authenticated" on public.profiles
  for select using (auth.uid() is not null);

create policy "read invites for authenticated" on public.pending_invites
  for select using (auth.uid() is not null);

-- Write policies (authenticated only)
create policy "auth insert teams" on public.teams
  for insert with check (auth.uid() is not null);

create policy "auth delete teams" on public.teams
  for delete using (auth.uid() is not null);

create policy "auth insert matches" on public.matches
  for insert with check (auth.uid() is not null);

create policy "auth update matches" on public.matches
  for update using (auth.uid() is not null);

create policy "auth delete matches" on public.matches
  for delete using (auth.uid() is not null);

create policy "auth insert results" on public.match_results
  for insert with check (auth.uid() is not null);

create policy "auth update results" on public.match_results
  for update using (auth.uid() is not null);

create policy "auth upsert live" on public.live_game
  for insert with check (auth.uid() is not null);

create policy "auth update live" on public.live_game
  for update using (auth.uid() is not null);

create policy "master manage invites" on public.pending_invites
  for all using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'master'
    )
  );

-- Only masters can update profiles (for promotion via RPC)
create policy "user update own profile" on public.profiles
  for update using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = (select p2.role from public.profiles p2 where p2.id = auth.uid())
  );

-- Only masters can update profiles (for promotion via RPC)
create policy "master update profiles" on public.profiles
  for update using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'master'
    )
  );

-- Automatically create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
declare
  new_role text := 'observer';
begin
  select role into new_role
  from public.pending_invites
  where email = lower(new.email);

  if new_role is null then
    if lower(new.email) in ('daiane.esteves@outlook.com', 'claudioemerenciano@hotmail.com') then
      new_role := 'master';
    else
      new_role := 'observer';
    end if;
  end if;

  insert into public.profiles (id, email, role)
  values (new.id, lower(new.email), new_role);

  delete from public.pending_invites where email = lower(new.email);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Promote users to master (only masters can call)
create or replace function public.invite_master(email_input text)
returns void as $$
begin
  if not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'master'
  ) then
    raise exception 'Not authorized';
  end if;

  insert into public.pending_invites (email, role)
  values (lower(email_input), 'master')
  on conflict (email) do update set role = 'master';
end;
$$ language plpgsql security definer;
