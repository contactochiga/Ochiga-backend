-- Phase 2 commercial-hardening: additively extend the membership_role enum
-- with canonical PLATFORM_ROLES values, so a NEW estate team-invite (Phase
-- 2's invite-a-teammate-by-role flow) can represent operator roles the
-- legacy 9-value vocabulary (owner/admin/manager/security/resident/member/
-- guest/staff/viewer) cannot -- most importantly finance_operator, which has
-- no legacy equivalent at all.
--
-- Purely additive: existing rows and existing legacy values are completely
-- untouched. New invites/memberships may use EITHER vocabulary going
-- forward; estate_membership_role_to_platform_role() (previous migration)
-- already passes these canonical values through unchanged, so no further
-- activation-logic change is needed here.
--
-- Postgres requires ALTER TYPE ... ADD VALUE to run outside an explicit
-- transaction block in older versions; each statement is run standalone
-- (no BEGIN/COMMIT wrapping) so this is safe to apply via the Supabase CLI
-- or SQL editor as-is.

alter type membership_role add value if not exists 'estate_admin';
alter type membership_role add value if not exists 'facility_manager';
alter type membership_role add value if not exists 'security_operator';
alter type membership_role add value if not exists 'maintenance_operator';
alter type membership_role add value if not exists 'finance_operator';
