create table if not exists public.player_entries (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references public.matches(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  player_name text not null,
  team_side text not null check (team_side in ('A', 'B')),
  date_iso text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_player_entries_date on public.player_entries(date_iso);
create index if not exists idx_player_entries_user on public.player_entries(user_id);

alter table public.player_entries enable row level security;

create policy "read own entries" on public.player_entries
  for select using (auth.uid() is not null and user_id = auth.uid());

create policy "master read all entries" on public.player_entries
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'master'
    )
  );

create policy "public read entries" on public.player_entries
  for select using (true);

create policy "insert own entries" on public.player_entries
  for insert with check (auth.uid() is not null and user_id = auth.uid());
