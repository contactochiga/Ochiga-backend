-- Ochiga/Oyi Tier 1 identity extension.
-- Adds per-user permission overrides used by Office, Facility, Consumer, Edge,
-- Digital Twin, Plan Studio, and Oyi AI without changing legacy role behavior.

alter table if exists users
  add column if not exists permission_scopes text[] not null default '{}'::text[];

create index if not exists idx_users_permission_scopes
  on users using gin(permission_scopes);
