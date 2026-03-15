create table if not exists public.app_settings (
  id int primary key default 1,
  quick_duration_seconds int not null default 420,
  alert_seconds int not null default 20,
  sound_enabled boolean not null default true,
  default_team_a text not null default 'Com Colete',
  default_team_b text not null default 'Sem Colete',
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

drop policy if exists "public read app settings" on public.app_settings;
create policy "public read app settings" on public.app_settings
  for select using (true);

drop policy if exists "master manage app settings" on public.app_settings;
create policy "master manage app settings" on public.app_settings
  for all using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'master'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'master'
    )
  );

create or replace function public.set_app_settings_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_app_settings_updated_at on public.app_settings;
create trigger trg_app_settings_updated_at
before update on public.app_settings
for each row execute function public.set_app_settings_updated_at();

insert into public.app_settings (
  id,
  quick_duration_seconds,
  alert_seconds,
  sound_enabled,
  default_team_a,
  default_team_b
)
values (1, 420, 20, true, 'Com Colete', 'Sem Colete')
on conflict (id) do nothing;
