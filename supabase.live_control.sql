create table if not exists public.live_control_lock (
  id integer primary key default 1 check (id = 1),
  controller_user_id uuid null references auth.users(id) on delete set null,
  controller_email text null,
  controller_name text null,
  controller_device_id text null,
  heartbeat_at timestamptz null,
  updated_at timestamptz not null default now()
);

create or replace function public.touch_live_control_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_live_control_updated_at on public.live_control_lock;
create trigger trg_live_control_updated_at
before update on public.live_control_lock
for each row
execute function public.touch_live_control_updated_at();

insert into public.live_control_lock (id)
values (1)
on conflict (id) do nothing;

alter table public.live_control_lock enable row level security;

drop policy if exists "public read live control lock" on public.live_control_lock;
create policy "public read live control lock"
on public.live_control_lock
for select
using (true);

drop policy if exists "master insert live control lock" on public.live_control_lock;
create policy "master insert live control lock"
on public.live_control_lock
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'master'
      and coalesce(p.is_active, true) = true
  )
);

drop policy if exists "master update live control lock" on public.live_control_lock;
create policy "master update live control lock"
on public.live_control_lock
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'master'
      and coalesce(p.is_active, true) = true
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'master'
      and coalesce(p.is_active, true) = true
  )
);
