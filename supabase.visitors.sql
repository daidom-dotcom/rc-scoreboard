alter table public.app_settings
add column if not exists quick_min_players_per_team int not null default 0;

create table if not exists public.daily_visitors (
  id uuid primary key default gen_random_uuid(),
  player_name text not null,
  date_iso text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_daily_visitors_date on public.daily_visitors(date_iso);
create unique index if not exists idx_daily_visitors_unique on public.daily_visitors(date_iso, lower(player_name));

alter table public.daily_visitors enable row level security;

drop policy if exists "master read visitors" on public.daily_visitors;
create policy "master read visitors" on public.daily_visitors
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('master', 'scoreboard')
    )
  );

drop policy if exists "master insert visitors" on public.daily_visitors;
create policy "master insert visitors" on public.daily_visitors
  for insert with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('master', 'scoreboard')
    )
  );

drop policy if exists "master delete visitors" on public.daily_visitors;
create policy "master delete visitors" on public.daily_visitors
  for delete using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('master', 'scoreboard')
    )
  );
