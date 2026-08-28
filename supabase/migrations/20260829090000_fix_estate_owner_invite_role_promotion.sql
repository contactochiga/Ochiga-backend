-- Phase 2 commercial-hardening: fix a critical bug found auditing Phase 1's
-- estate-owner invite activation. activate_estate_owner_invite() previously
-- left users.role at its default 'resident' for a brand-new activated owner
-- (line 134 of the original migration), and never touched users.role at all
-- for an EXISTING Oyi user accepting ownership. Since requirePermission()/
-- hasPermission() (src/middleware/auth.ts, src/core/foundation/permissions.ts)
-- read ONLY the single global users.role column -- estate_memberships.role is
-- never consulted by the real permission gate -- every facility owner who
-- activated through Phase 1's flow ended up with zero elevated permissions:
-- unable to manage their own team, profile, or anything else. This is the
-- unconditional first fix of Phase 2; nothing else in the administrative
-- backbone matters until an owner can actually act with authority.
--
-- The mapping below is deliberately NOT core/foundation/permissions.ts's
-- LEGACY_ROLE_ALIASES, which maps the bare word "admin" -> "super_admin".
-- That is correct for a PLATFORM-scoped legacy role string, but wrong here:
-- an estate-scoped invites.role of "admin" means "administrator of THIS
-- estate", and must become "estate_admin", never the platform role
-- "super_admin". Reusing LEGACY_ROLE_ALIASES here would have been a real
-- privilege-escalation bug in the opposite direction.

create or replace function estate_membership_role_to_platform_role(p_role text)
returns text
language sql
immutable
as $$
  select case p_role
    when 'owner' then 'estate_admin'
    when 'admin' then 'estate_admin'
    when 'manager' then 'facility_manager'
    when 'security' then 'security_operator'
    when 'staff' then 'maintenance_operator'
    when 'member' then 'resident'
    when 'guest' then 'guest'
    when 'viewer' then 'guest'
    -- Forward-compatible: if the invite already carries a canonical
    -- PLATFORM_ROLES value (the new team-invite-by-role flow writes these
    -- directly once the membership_role enum is extended), pass it through
    -- unchanged rather than falling through to the resident default below.
    when 'estate_admin' then 'estate_admin'
    when 'facility_manager' then 'facility_manager'
    when 'security_operator' then 'security_operator'
    when 'maintenance_operator' then 'maintenance_operator'
    when 'finance_operator' then 'finance_operator'
    else 'resident'
  end;
$$;

create or replace function activate_estate_owner_invite(
  p_token_hash text,
  p_username text,
  p_password_hash text,
  p_existing_user_id uuid
)
returns table (
  user_id uuid,
  estate_id uuid,
  estate_name text,
  role text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_invite invites%rowtype;
  v_user users%rowtype;
  v_platform_role text;
begin
  select i.* into v_invite
  from invites i
  where i.token_hash = p_token_hash
  for update;

  if v_invite.id is null then
    raise exception 'Invite not found';
  end if;
  if v_invite.home_id is not null then
    raise exception 'Not an estate-owner invite';
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
  if v_invite.estate_id is null or v_invite.invited_email is null then
    raise exception 'Invite is missing required estate context';
  end if;

  v_platform_role := estate_membership_role_to_platform_role(coalesce(nullif(v_invite.role::text, ''), 'owner'));

  if p_existing_user_id is not null then
    select u.* into v_user from users u where u.id = p_existing_user_id for update;
    if v_user.id is null then
      raise exception 'Authenticated user not found';
    end if;
    if lower(v_user.email) <> lower(v_invite.invited_email) then
      raise exception 'This invite was not sent to your account email';
    end if;
    -- FIX: promote the existing user's platform role too -- previously
    -- untouched, leaving even an existing account permission-less on the
    -- estate it just accepted ownership of.
    update users u set role = v_platform_role, updated_at = now() where u.id = v_user.id;
    v_user.role := v_platform_role;
  else
    if p_username is null or btrim(p_username) = '' or p_password_hash is null then
      raise exception 'Username and password are required to activate this invite';
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
      -- FIX: role is now the real promoted platform role, not the
      -- hardcoded 'resident' default the original migration used.
      insert into users (email, username, password_hash, role, onboarding_complete, account_status)
      values (lower(v_invite.invited_email), btrim(p_username), p_password_hash, v_platform_role, true, 'active')
      returning * into v_user;
    else
      if v_user.password_hash is not null then
        raise exception 'An account already exists for this email. Please sign in instead.';
      end if;
      update users u
      set username = btrim(p_username),
          password_hash = p_password_hash,
          role = v_platform_role,
          onboarding_complete = true,
          account_status = 'active',
          updated_at = now()
      where u.id = v_user.id
      returning * into v_user;
    end if;
  end if;

  update estate_memberships em
  set role = coalesce(nullif(v_invite.role::text, ''), 'owner')::membership_role,
      status = 'active',
      updated_at = now()
  where em.estate_id = v_invite.estate_id and em.user_id = v_user.id;

  if not found then
    insert into estate_memberships (estate_id, user_id, role, status, updated_at)
    values (v_invite.estate_id, v_user.id, coalesce(nullif(v_invite.role::text, ''), 'owner')::membership_role, 'active', now());
  end if;

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
    v_invite.role::text
  from estates e
  where e.id = v_invite.estate_id;
end;
$$;

revoke all on function estate_membership_role_to_platform_role(text) from public, anon, authenticated;
revoke all on function activate_estate_owner_invite(text, text, text, uuid) from public, anon, authenticated;
grant execute on function estate_membership_role_to_platform_role(text) to service_role;
grant execute on function activate_estate_owner_invite(text, text, text, uuid) to service_role;

-- Data repair: any estate owner who already activated through the buggy
-- version of this RPC and is still sitting at role='resident' despite
-- holding an active 'owner'/'admin' estate_memberships row gets promoted
-- now. Scoped tightly (only resident-role users with an active owner/admin
-- membership) so this cannot touch any unrelated account, and is idempotent
-- (re-running finds nothing left to fix).
update users u
set role = 'estate_admin', updated_at = now()
from estate_memberships em
where em.user_id = u.id
  and em.status = 'active'
  and em.role in ('owner', 'admin')
  and u.role = 'resident';
