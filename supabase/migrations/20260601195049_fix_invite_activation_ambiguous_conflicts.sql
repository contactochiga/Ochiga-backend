-- Fix invite activation ambiguity caused by PL/pgSQL output-column variables
-- colliding with ON CONFLICT column inference. Named constraints keep the
-- activation transaction explicit and deterministic.

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
  select i.* into v_invite
  from invites i
  where i.token_hash = p_token_hash
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
    update invites i set status = 'expired', updated_at = now() where i.id = v_invite.id;
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

  select u.* into v_user
  from users u
  where lower(u.email) = lower(v_invite.invited_email)
  for update;

  if v_user.id is null then
    raise exception 'Invited user record not found';
  end if;

  update users u
  set username = btrim(p_username),
      password_hash = p_password_hash,
      onboarding_complete = true,
      account_status = 'active',
      estate_id = v_invite.estate_id,
      home_id = v_invite.home_id,
      updated_at = now()
  where u.id = v_user.id;

  insert into estate_memberships (estate_id, user_id, role, status, updated_at)
  values (v_invite.estate_id, v_user.id, 'resident', 'active', now())
  on conflict on constraint uq_estate_memberships
  do update set status = 'active', updated_at = now();

  insert into home_memberships (home_id, user_id, role, status, updated_at)
  values (v_invite.home_id, v_user.id, v_invite.role, 'active', now())
  on conflict on constraint uq_home_memberships
  do update set role = excluded.role, status = 'active', updated_at = now();

  update invites i
  set status = 'accepted',
      claimed_by = v_user.id,
      claimed_at = now(),
      updated_at = now()
  where i.id = v_invite.id;

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

revoke all on function activate_resident_invite(text, text, text) from public, anon, authenticated;
grant execute on function activate_resident_invite(text, text, text) to service_role;
