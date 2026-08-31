-- Security fix: activate_resident_invite() unconditionally wrote
-- username/password_hash on every activation, with no branch for an
-- existing Oyi identity accepting an additional Home invitation. An
-- existing identity accepting a second Home invite went through the exact
-- same "new user" path as a brand-new signup, silently overwriting their
-- real password with whatever was typed on the invitation-activation
-- screen. Confirmed this actually happened in production (not just
-- theoretical): audit_events shows one identity (info.pavnigeria@gmail.com)
-- activated two separate resident invites six weeks apart (2026-06-03,
-- 2026-07-17); the second activation silently replaced the credentials set
-- by the first. No account lockout resulted (their current password still
-- works, all three home_memberships rows stayed correctly additive), so no
-- data repair is performed here -- there is nothing broken to repair, only
-- the RPC's behavior going forward.
--
-- Mirrors the EXACT pattern activate_estate_owner_invite() already
-- established for this same problem (20260829090000_fix_estate_owner_
-- invite_role_promotion.sql): a p_existing_user_id parameter. When set,
-- the caller has already authenticated (verified by requireAuth at the
-- route layer) and this function only checks the authenticated identity's
-- email matches the invite recipient, then creates the new scoped
-- memberships -- username/password_hash are NEVER touched on that path.
-- When null, the original new-identity flow runs, now additionally
-- refusing to overwrite an identity that already has a password set
-- (the same "please sign in instead" guard activate_estate_owner_invite
-- already uses), so invitation possession alone can never mutate an
-- existing account's credentials through the new-user branch either.
--
-- Also fixes a second, related defect: this function unconditionally
-- overwrote users.estate_id/users.home_id on every activation, even
-- though estate_memberships/home_memberships (both correctly additive,
-- both untouched by this fix) are the actual authorization source of
-- truth -- these two columns are only an optional default/active-context
-- convenience. Changed to coalesce: an identity's first-ever Home
-- activation still initializes them (acceptable, matches existing
-- product behavior for a brand-new resident), but an identity that
-- already has a default context keeps it when accepting an additional
-- Home -- it does not silently switch. Consumer's existing active-context
-- selector (GET /me/context/resolved, estate_memberships/home_memberships-
-- driven) is the mechanism for deliberately switching between Homes an
-- identity actually holds membership in; this migration does not
-- introduce a second one.
--
-- The function signature is changing (3 args -> 4 args). Explicitly
-- dropping the old 3-arg overload rather than only adding a new
-- signature: leaving both would mean any caller still invoking the old
-- 3-arg form silently resolves to the un-fixed overload, defeating the
-- point of this fix. This is also why the drop+create (not a bare
-- create-or-replace) here can never reintroduce the role-promotion-style
-- regression already hit once on activate_estate_owner_invite
-- (20260901100000_fix_estate_owner_role_promotion_regression.sql, where a
-- later migration's create-or-replace silently reverted an earlier fix by
-- copy-pasting a stale body under the same signature): there is no older
-- 4-arg body for a future migration to accidentally revert back to, and
-- this file's body is written fresh from the current live definition, not
-- copied from an older migration file.

drop function if exists activate_resident_invite(text, text, text);

create or replace function activate_resident_invite(
  p_token_hash text,
  p_username text,
  p_password_hash text,
  p_existing_user_id uuid
)
returns table(
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
set search_path to 'public'
as $function$
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

  if p_existing_user_id is not null then
    -- EXISTING IDENTITY: the route layer only reaches here after the
    -- caller authenticated normally (requireAuth) -- p_existing_user_id
    -- is always the authenticated caller's own id, never attacker-
    -- supplied. Verify the authenticated identity is actually the
    -- invitation's recipient, then never touch username/password_hash.
    select u.* into v_user from users u where u.id = p_existing_user_id for update;
    if v_user.id is null then
      raise exception 'Authenticated user not found';
    end if;
    if lower(v_user.email) <> lower(v_invite.invited_email) then
      raise exception 'This invite was not sent to your account email';
    end if;

    update users u
    set onboarding_complete = true,
        account_status = 'active',
        estate_id = coalesce(u.estate_id, v_invite.estate_id),
        home_id = coalesce(u.home_id, v_invite.home_id),
        updated_at = now()
    where u.id = v_user.id;
  else
    -- NEW IDENTITY: sets credentials for the first time on this screen.
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
      raise exception 'Invited user record not found';
    end if;

    if v_user.password_hash is not null then
      -- This identity already has real credentials (either a genuine
      -- prior signup, or activation of an earlier invite) -- invitation
      -- possession alone must not be sufficient to replace them. The
      -- caller must authenticate normally and retry through the
      -- existing-identity (p_existing_user_id) path above.
      raise exception 'An account already exists for this email. Please sign in instead.';
    end if;

    update users u
    set username = btrim(p_username),
        password_hash = p_password_hash,
        onboarding_complete = true,
        account_status = 'active',
        estate_id = coalesce(u.estate_id, v_invite.estate_id),
        home_id = coalesce(u.home_id, v_invite.home_id),
        updated_at = now()
    where u.id = v_user.id;
  end if;

  update estate_memberships em
  set status = 'active', updated_at = now()
  where em.estate_id = v_invite.estate_id and em.user_id = v_user.id;

  if not found then
    insert into estate_memberships (estate_id, user_id, role, status, updated_at)
    values (v_invite.estate_id, v_user.id, 'resident', 'active', now());
  end if;

  update home_memberships hm
  set role = v_invite.role, status = 'active', updated_at = now()
  where hm.home_id = v_invite.home_id and hm.user_id = v_user.id;

  if not found then
    insert into home_memberships (home_id, user_id, role, status, updated_at)
    values (v_invite.home_id, v_user.id, v_invite.role, 'active', now());
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
    h.id,
    h.name,
    h.block,
    h.unit,
    v_invite.role::text
  from estates e
  join homes h on h.id = v_invite.home_id
  where e.id = v_invite.estate_id;
end;
$function$;

revoke all on function activate_resident_invite(text, text, text, uuid) from public, anon, authenticated;
grant execute on function activate_resident_invite(text, text, text, uuid) to service_role;
