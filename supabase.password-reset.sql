alter table public.profiles
add column if not exists must_reset_password boolean not null default false;

comment on column public.profiles.must_reset_password is 'Quando true, o usuário deve redefinir a senha antes de entrar novamente.';
