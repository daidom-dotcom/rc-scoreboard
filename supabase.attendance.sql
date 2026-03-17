create table if not exists public.daily_attendance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  player_name text not null,
  date_iso text not null,
  checked_at timestamptz not null default now(),
  unique (user_id, date_iso)
);

create index if not exists idx_daily_attendance_date on public.daily_attendance(date_iso);
create index if not exists idx_daily_attendance_user on public.daily_attendance(user_id);

alter table public.daily_attendance enable row level security;

drop policy if exists "read own attendance" on public.daily_attendance;
create policy "read own attendance" on public.daily_attendance
  for select using (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "master read attendance" on public.daily_attendance;
create policy "master read attendance" on public.daily_attendance
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('master', 'scoreboard')
    )
  );

drop policy if exists "public read attendance" on public.daily_attendance;
create policy "public read attendance" on public.daily_attendance
  for select using (false);

drop policy if exists "insert own attendance" on public.daily_attendance;
create policy "insert own attendance" on public.daily_attendance
  for insert with check (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "update own attendance" on public.daily_attendance;
create policy "update own attendance" on public.daily_attendance
  for update using (auth.uid() is not null and user_id = auth.uid())
  with check (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "delete master attendance" on public.daily_attendance;
create policy "delete master attendance" on public.daily_attendance
  for delete using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('master', 'scoreboard')
    )
  );
