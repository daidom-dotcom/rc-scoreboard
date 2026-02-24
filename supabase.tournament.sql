-- Add tournaments table
create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text,
  start_date text not null,
  end_date text,
  status text not null check (status in ('active', 'done')),
  created_at timestamptz not null default now()
);

-- Add tournament_id to matches
alter table public.matches
  add column if not exists tournament_id uuid references public.tournaments(id);

create index if not exists idx_matches_tournament on public.matches(tournament_id);

-- RLS
alter table public.tournaments enable row level security;

create policy "public read tournaments" on public.tournaments
  for select using (true);

create policy "auth insert tournaments" on public.tournaments
  for insert with check (auth.uid() is not null);

create policy "auth update tournaments" on public.tournaments
  for update using (auth.uid() is not null);
