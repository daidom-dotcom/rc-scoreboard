alter table public.app_settings
  add column if not exists quick_timer_scale numeric not null default 2,
  add column if not exists quick_score_scale numeric not null default 2,
  add column if not exists quick_logo_scale numeric not null default 1,
  add column if not exists quick_match_label_scale numeric not null default 1,
  add column if not exists quick_team_name_scale numeric not null default 1,
  add column if not exists quick_player_name_scale numeric not null default 1,
  add column if not exists quick_controls_scale numeric not null default 1;
