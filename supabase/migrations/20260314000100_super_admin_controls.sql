-- Super admin governance layer
-- Adds status/freeze controls and audit logs for command-center actions

alter table if exists estates
  add column if not exists status text not null default 'active';

alter table if exists estates
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'estates_status_chk'
  ) then
    alter table estates
      add constraint estates_status_chk check (status in ('active', 'suspended'));
  end if;
end $$;

alter table if exists users
  add column if not exists account_status text not null default 'active';

alter table if exists users
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_account_status_chk'
  ) then
    alter table users
      add constraint users_account_status_chk check (account_status in ('active', 'suspended'));
  end if;
end $$;

alter table if exists devices
  add column if not exists is_managed_disabled boolean not null default false;

alter table if exists devices
  add column if not exists updated_at timestamptz not null default now();

alter table if exists wallets
  add column if not exists is_frozen boolean not null default false;

create table if not exists super_admin_audit_logs (
  id uuid default gen_random_uuid() primary key,
  actor_id uuid null references users(id) on delete set null,
  actor_role text null,
  action text not null,
  target_type text not null,
  target_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_super_admin_audit_logs_created
  on super_admin_audit_logs(created_at desc);

create index if not exists idx_super_admin_audit_logs_target
  on super_admin_audit_logs(target_type, target_id, created_at desc);
