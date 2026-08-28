-- Commercial production-hardening: estate-level facility-owner invitations.
-- Reuses the exact `invites` table and hashed-token/row-lock replay-
-- protection pattern already proven by validate_resident_invite/
-- activate_resident_invite (20260601000100_invite_first_onboarding_phase1
-- + its two follow-up fixes) -- home_id/room_id on `invites` are already
-- nullable, so an estate-owner invite is simply an invites row with
-- estate_id set and home_id/room_id null. No new table, no new invitation
-- engine, no new column on `estates` (an estate with zero active
-- estate_memberships rows IS its own "pending activation" state -- nothing
-- further to track).
--
-- Follows the SAME safe update-then-insert-if-not-found pattern the resident
-- activation RPC was corrected to use in
-- 20260601195502_fix_invite_activation_membership_upsert.sql (a bare
-- `on conflict (col,col)` clause was found to collide ambiguously with
-- PL/pgSQL output-column variables of the same name) -- never reintroducing
-- that already-fixed bug.

create or replace function validate_estate_owner_invite(p_token_hash text)
returns table (
  invite_id uuid,
  estate_id uuid,
  estate_name text,
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
    i.invited_email,
    i.role::text,
    i.expires_at
  from invites i
  join estates e on e.id = i.estate_id
  where i.token_hash = p_token_hash
    and i.home_id is null
    and i.status = 'pending'
    and i.revoked_at is null
    and i.expires_at > now();

  if not found then
    raise exception 'Invite not found, expired, revoked, or already accepted';
  end if;
end;
$$;

-- p_username/p_password_hash are null for an already-registered Oyi user who
-- is only accepting estate ownership (p_existing_user_id set instead) --
-- they authenticate via the normal login flow first; the CALLER (Express
-- route, not this function) is responsible for verifying the authenticated
-- session's email matches the invite's invited_email before passing
-- p_existing_user_id.
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

  if p_existing_user_id is not null then
    select u.* into v_user from users u where u.id = p_existing_user_id for update;
    if v_user.id is null then
      raise exception 'Authenticated user not found';
    end if;
    if lower(v_user.email) <> lower(v_invite.invited_email) then
      raise exception 'This invite was not sent to your account email';
    end if;
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
      -- Unlike the resident flow, Office does not pre-create a placeholder
      -- users row for an estate-owner invite -- create one now.
      insert into users (email, username, password_hash, role, onboarding_complete, account_status)
      values (lower(v_invite.invited_email), btrim(p_username), p_password_hash, 'resident', true, 'active')
      returning * into v_user;
    else
      if v_user.password_hash is not null then
        raise exception 'An account already exists for this email. Please sign in instead.';
      end if;
      update users u
      set username = btrim(p_username),
          password_hash = p_password_hash,
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

revoke all on function validate_estate_owner_invite(text) from public, anon, authenticated;
revoke all on function activate_estate_owner_invite(text, text, text, uuid) from public, anon, authenticated;
grant execute on function validate_estate_owner_invite(text) to service_role;
grant execute on function activate_estate_owner_invite(text, text, text, uuid) to service_role;
