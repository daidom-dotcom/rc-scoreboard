create table if not exists public.basket_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  date_iso text not null,
  mode text not null,
  match_no int,
  team_side text not null check (team_side in ('A','B')),
  player_name text not null,
  points int not null check (points in (1,2,3)),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_basket_events_match on public.basket_events(match_id);
create index if not exists idx_basket_events_created_at on public.basket_events(created_at desc);

alter table public.basket_events enable row level security;

drop policy if exists "public read basket_events" on public.basket_events;
create policy "public read basket_events" on public.basket_events
  for select using (true);

drop policy if exists "auth insert basket_events" on public.basket_events;
create policy "auth insert basket_events" on public.basket_events
  for insert with check (auth.uid() is not null);

drop policy if exists "auth delete basket_events" on public.basket_events;
create policy "auth delete basket_events" on public.basket_events
  for delete using (auth.uid() is not null);

create or replace function public.record_live_basket(
  match_id_input uuid,
  team_side_input text,
  player_name_input text,
  points_input int
)
returns table(score_a int, score_b int, updated_at timestamptz)
language plpgsql
security definer
as $$
declare
  live_row public.live_game%rowtype;
begin
  if points_input not in (1,2,3) then
    raise exception 'invalid points';
  end if;
  if team_side_input not in ('A','B') then
    raise exception 'invalid team side';
  end if;

  select * into live_row
  from public.live_game
  where id = 1
  for update;

  if live_row.id is null then
    raise exception 'live_game row not found';
  end if;

  if live_row.match_id is distinct from match_id_input then
    raise exception 'match mismatch';
  end if;

  insert into public.basket_events(match_id, date_iso, mode, match_no, team_side, player_name, points, created_by)
  values (
    match_id_input,
    (select m.date_iso from public.matches m where m.id = match_id_input),
    coalesce(live_row.mode, 'quick'),
    live_row.match_no,
    team_side_input,
    player_name_input,
    points_input,
    auth.uid()
  );

  update public.live_game
  set
    score_a = case when team_side_input = 'A' then score_a + points_input else score_a end,
    score_b = case when team_side_input = 'B' then score_b + points_input else score_b end,
    updated_at = now()
  where id = 1
  returning live_game.score_a, live_game.score_b, live_game.updated_at
  into score_a, score_b, updated_at;

  return next;
end;
$$;

create or replace function public.delete_live_basket(
  event_id_input uuid
)
returns table(score_a int, score_b int, updated_at timestamptz)
language plpgsql
security definer
as $$
declare
  ev public.basket_events%rowtype;
begin
  select * into ev
  from public.basket_events
  where id = event_id_input
  for update;

  if ev.id is null then
    raise exception 'event not found';
  end if;

  delete from public.basket_events where id = event_id_input;

  update public.live_game
  set
    score_a = case when ev.team_side = 'A' then greatest(0, score_a - ev.points) else score_a end,
    score_b = case when ev.team_side = 'B' then greatest(0, score_b - ev.points) else score_b end,
    updated_at = now()
  where id = 1
  returning live_game.score_a, live_game.score_b, live_game.updated_at
  into score_a, score_b, updated_at;

  return next;
end;
$$;
