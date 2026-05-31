-- User profile phone support for Oyi Home.
-- Keeps email immutable while allowing resident profile contact details to persist.

alter table if exists public.users
  add column if not exists phone text;
