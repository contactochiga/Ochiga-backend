alter table if exists public.users
  add column if not exists avatar_url text;

alter table if exists public.users
  add column if not exists profile_image_url text;;
