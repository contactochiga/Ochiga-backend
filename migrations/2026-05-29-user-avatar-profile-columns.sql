-- User profile avatar support for Oyi Home.
-- Public reads are intentional for resident avatars; writes stay backend-authenticated.

alter table if exists public.users
  add column if not exists avatar_url text;

alter table if exists public.users
  add column if not exists profile_image_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  6291456,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
