alter table public.profiles
add column if not exists nickname text;

update public.profiles
set nickname = split_part(coalesce(full_name, email), ' ', 1)
where coalesce(trim(nickname), '') = '';

comment on column public.profiles.nickname is 'Apelido exibido no app; tem prioridade sobre full_name.';
