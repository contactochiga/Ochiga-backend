-- Oyi invite-first onboarding Phase 1.
-- Core identity tables are server-managed. Express uses the service-role key,
-- while direct Data API access is revoked from public client roles.

alter table if exists users
  add column if not exists onboarding_complete boolean not null default false;

alter table if exists invites
  add column if not exists claimed_by uuid references users(id) on delete set null,
  add column if not exists claimed_at timestamptz,
  add column if not exists delivery_status text,
  add column if not exists last_sent_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references users(id) on delete set null,
  add column if not exists updated_at timestamptz default now();

create unique index if not exists uq_invites_token_hash on invites(token_hash);
create unique index if not exists uq_users_username_lower
  on users (lower(username))
  where username is not null and btrim(username) <> '';
create index if not exists idx_invites_home_status on invites(home_id, status);
create index if not exists idx_invites_email_status on invites(lower(invited_email), status);

create or replace function validate_resident_invite(p_token_hash text)
returns table (
  invite_id uuid,
  estate_id uuid,
  estate_name text,
  home_id uuid,
  home_label text,
  invited_email text,
  role text,
  expires_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  select
    i.id,
    i.estate_id,
    e.name,
    i.home_id,
    coalesce(nullif(concat_ws(' / ', nullif(h.block, ''), nullif(h.unit, '')), ''), h.name),
    i.invited_email,
    i.role::text,
    i.expires_at
  from invites i
  join estates e on e.id = i.estate_id
  join homes h on h.id = i.home_id and h.estate_id = i.estate_id
  where i.token_hash = p_token_hash
    and i.status = 'pending'
    and i.revoked_at is null
    and i.expires_at > now();

  if not found then
    raise exception 'Invite not found, expired, revoked, or already accepted';
  end if;
end;
$$;

create or replace function activate_resident_invite(
  p_token_hash text,
  p_username text,
  p_password_hash text
)
returns table (
  user_id uuid,
  estate_id uuid,
  estate_name text,
  home_id uuid,
  home_name text,
  home_block text,
  home_unit text,
  role text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_invite invites%rowtype;
  v_user users%rowtype;
begin
  select * into v_invite
  from invites
  where token_hash = p_token_hash
  for update;

  if v_invite.id is null then
    raise exception 'Invite not found';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'Invite is not pending';
  end if;
  if v_invite.revoked_at is not null then
    raise exception 'Invite has been revoked';
  end if;
  if v_invite.expires_at <= now() then
    update invites set status = 'expired', updated_at = now() where id = v_invite.id;
    raise exception 'Invite has expired';
  end if;
  if v_invite.estate_id is null or v_invite.home_id is null or v_invite.invited_email is null then
    raise exception 'Invite is missing required resident context';
  end if;
  if not exists (
    select 1 from homes h where h.id = v_invite.home_id and h.estate_id = v_invite.estate_id
  ) then
    raise exception 'Invite home does not belong to invite estate';
  end if;
  if exists (
    select 1 from users u where lower(u.username) = lower(btrim(p_username))
      and lower(u.email) <> lower(v_invite.invited_email)
  ) then
    raise exception 'Username is already in use';
  end if;

  select * into v_user
  from users
  where lower(email) = lower(v_invite.invited_email)
  for update;

  if v_user.id is null then
    raise exception 'Invited user record not found';
  end if;

  update users
  set username = btrim(p_username),
      password_hash = p_password_hash,
      onboarding_complete = true,
      account_status = 'active',
      estate_id = v_invite.estate_id,
      home_id = v_invite.home_id,
      updated_at = now()
  where id = v_user.id;

  insert into estate_memberships (estate_id, user_id, role, status, updated_at)
  values (v_invite.estate_id, v_user.id, 'resident', 'active', now())
  on conflict (estate_id, user_id)
  do update set status = 'active', updated_at = now();

  insert into home_memberships (home_id, user_id, role, status, updated_at)
  values (v_invite.home_id, v_user.id, v_invite.role, 'active', now())
  on conflict (home_id, user_id)
  do update set role = excluded.role, status = 'active', updated_at = now();

  update invites
  set status = 'accepted',
      claimed_by = v_user.id,
      claimed_at = now(),
      updated_at = now()
  where id = v_invite.id;

  return query
  select
    v_user.id,
    e.id,
    e.name,
    h.id,
    h.name,
    h.block,
    h.unit,
    v_invite.role::text
  from estates e
  join homes h on h.id = v_invite.home_id
  where e.id = v_invite.estate_id;
end;
$$;

revoke all on function validate_resident_invite(text) from public, anon, authenticated;
revoke all on function activate_resident_invite(text, text, text) from public, anon, authenticated;
grant execute on function validate_resident_invite(text) to service_role;
grant execute on function activate_resident_invite(text, text, text) to service_role;

revoke all privileges on table users from anon, authenticated;
revoke all privileges on table homes from anon, authenticated;
revoke all privileges on table estate_memberships from anon, authenticated;
revoke all privileges on table home_memberships from anon, authenticated;
revoke all privileges on table invites from anon, authenticated;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'users' and column_name = 'password'
  ) then
    comment on column users.password is
      'Legacy unused column. Do not write new credentials here. Audit existing data before removal.';
  end if;
end
$$;
