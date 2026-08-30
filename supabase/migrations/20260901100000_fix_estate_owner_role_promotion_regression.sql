-- Production regression: 20260901090000_soften_estate_owner_invite_conflict_
-- message.sql re-created activate_estate_owner_invite() from the ORIGINAL
-- (Phase 1) migration's function body to change one error message, but that
-- body predates 20260829090000_fix_estate_owner_invite_role_promotion.sql's
-- fix -- it never called estate_membership_role_to_platform_role() or
-- updated users.role at all. create or replace silently discarded the
-- role-promotion fix while keeping the softened message, so every estate
-- owner (new or existing identity) who activated since has been left at
-- users.role='resident' -- exactly the bug 20260829090000 already fixed
-- once, now regressed. This migration re-applies that same fix, this time
-- keeping the softened message too, so neither regresses again.
--
-- estate_membership_role_to_platform_role() itself was untouched by the
-- regression (it's a separate function) and needs no change.

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
    -- Existing identity: promote the platform role for this activation,
    -- but this NEVER touches any other estate_memberships row -- the
    -- update below is scoped to (estate_id, user_id), so memberships on
    -- other Facilities are completely unaffected.
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
      insert into users (email, username, password_hash, role, onboarding_complete, account_status)
      values (lower(v_invite.invited_email), btrim(p_username), p_password_hash, v_platform_role, true, 'active')
      returning * into v_user;
    else
      if v_user.password_hash is not null then
        -- Softened per Office->Facility provisioning lifecycle requirement
        -- #6 (generic invalid/expired responses; do not leak account
        -- existence) -- kept from the regressed migration, not reverted.
        raise exception 'This invitation could not be completed. If you already have an Oyi account, please sign in instead.';
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

revoke all on function activate_estate_owner_invite(text, text, text, uuid) from public, anon, authenticated;
grant execute on function activate_estate_owner_invite(text, text, text, uuid) to service_role;

-- Data repair: re-run of the same idempotent, tightly-scoped repair from
-- 20260829090000 -- any estate owner who activated during the regressed
-- window (between that migration and this one) and is still sitting at
-- role='resident' despite holding an active 'owner'/'admin'
-- estate_memberships row gets promoted now. Only touches resident-role
-- users with an active owner/admin membership, so this cannot affect any
-- unrelated account, and re-running finds nothing left to fix.
update users u
set role = 'estate_admin', updated_at = now()
from estate_memberships em
where em.user_id = u.id
  and em.status = 'active'
  and em.role in ('owner', 'admin')
  and u.role = 'resident';
