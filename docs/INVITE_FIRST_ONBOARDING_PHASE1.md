# Invite-First Onboarding Phase 1

## Canonical contract

New resident onboarding uses:

- `POST /facility/homes/:homeId/invite`
- `POST /auth/invites/validate`
- `POST /auth/invites/activate`
- `POST /facility/homes/:homeId/invites/:inviteId/revoke`
- `POST /facility/homes/:homeId/invites/:inviteId/resend`

The older `/facility/invites`, `/invites`, and `/auth/onboard/complete` paths are
compatibility-only. `/auth/onboard/complete` now returns `410 Gone`.

## Deployment order

1. Review the linked Supabase dry-run.
2. Apply `20260601000100_invite_first_onboarding_phase1.sql`.
3. Deploy the backend.
4. Run API smoke tests against a non-production resident invite.
5. Continue with the Facility invite-management UI.

## Legacy password column

`users.password_hash` is the canonical credential field. `users.password` is a
legacy compatibility column and must not be written by new onboarding code.

The June 1, 2026 live preflight found three rows populated only in
`users.password`. Do not remove that column until those accounts have completed
a credential recovery or migration process and a follow-up audit confirms that
no legacy-only values remain.

## Data API boundary

The Supabase migration revokes direct `anon` and `authenticated` table
privileges for:

- `users`
- `homes`
- `estate_memberships`
- `home_memberships`
- `invites`

These tables remain server-managed through the service-role backend.
