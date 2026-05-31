alter table if exists public.consumer_scenes
  add column if not exists description text;
