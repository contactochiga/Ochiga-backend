# Commercial Production-Hardening — Phases 8-11 Audit (documentation only, no implementation)

Per the programme's explicit instruction, Phases 8-11 are audit/design deliverables that become
input to a future contract-expansion phase — nothing in this document was implemented as part of
this pass. Source: the Phase 0 architecture audits of all four repos (Ochiga Office, Ochiga
Backend, Oyi Facility, Oyi Consumer), plus targeted spot-checks while writing this document.

## Phase 8 — Settings / Account contract readiness map (Oyi Facility)

Facility has no dedicated `/settings` route; the closest analogues are `app/(protected)/account`
(individual operator) and `app/(protected)/facility-administration` (estate governance).

| Area | Status | Detail |
|---|---|---|
| **My Account** — name/photo/email/phone/password/sessions/MFA | PARTIAL | Read-only name/email/user ID/estate (`account/page.tsx`). No photo field, no phone field, no in-app password-change form, no MFA anywhere in the codebase. "Sign out"/"Delete session" only clear the local token — no Backend session-revocation call exists (consistent with Backend's audit finding: password reset does not invalidate existing JWTs, since there is no revocation list under the current stateless-JWT model). |
| **Facility Profile** — name/address/coordinates/timezone/type/logo/contact | PARTIAL | Name/address/type shown read-only. Timezone, branding, and "readiness editor" are explicitly labeled "Pending backend support" in the UI itself, with the edit button permanently disabled regardless of permission. No logo upload UI. No lat/lng editing UI (`estates.lat`/`lng` columns exist at the DB level but nothing in Facility writes them post-creation). |
| **Team & Access** — memberships/invitations/roles/permissions/revoke | PARTIAL → now the direct target of this commercial-hardening pass | Existing memberships list and the full role/permission matrix render read-only. **No invite-new-operator UI or backend endpoint existed at all before this pass** (`POST /facility/estate-users` does not exist) — only resident/home invites had a real create endpoint. This is the concrete gap Phase 5 of the main programme (facility team membership) should close next: reuse the estate-owner invite RPC pattern this pass just built, generalized to invite arbitrary estate-scoped roles (security_operator, maintenance_operator, finance_operator, facility_manager) by an already-authorized estate_admin, never a platform role. |
| **Notifications** | PARTIAL | Device-local toggles only (`localStorage`, not synced to Backend). Push provider (APNs/FCM) readiness is shown but delivery analytics are explicitly unavailable. |
| **Integrations** | EXISTS (read-only) | Tuya/Smart Life, Oyi Edge, camera providers, push providers shown via `platformDeploymentReadiness()`/`infrastructureOperations()`. No connect/disconnect actions from the UI. |
| **Automation permissions** | EXISTS (advisory only) | See Phase 9 matrix below — a real, working `AutomationExecutionMode` gate exists client-side, but it drives conversational recommendations, not a settings toggle. |
| **Security & Audit** | PARTIAL | A genuine, working audit log viewer exists (`AuditSection`, `superAdminService.auditLogs()`, `audit.read` permission, domain-filterable). "Security posture" section is descriptive text only, no controls. |
| **Deployment / Subscription status** | PARTIAL (readiness, not billing) | `platformDeploymentReadiness()` gives a technical checklist (push/integration health). **No subscription/billing/plan-tier concept exists anywhere in the codebase** — no Stripe or equivalent. |

**Also relevant to Consumer** (from that audit): no forgot/reset-password flow exists anywhere in
Oyi Consumer — a real, standing UX gap independent of this programme, worth flagging for the same
future settings pass.

## Phase 9 — Automation capability matrix

Two genuinely distinct systems exist in Backend and must not be conflated:

1. **Legacy device-automation rules** (`src/automations/`, table `automations`) — direct
   create-and-run CRUD with an NL-to-rule assistant. No approval/governance pipeline.
2. **Shared Automation Runtime** (`src/routes/scenes.ts`, tables `consumer_automations` /
   `consumer_automation_runs`) — the real, durable, idempotent (unique constraint on
   `(automation_id, trigger_occurrence_key)`) execution ledger. `AutomationSurface` is
   `"consumer" | "facility" | "office"`; **only `consumer` is live by default** —
   `AUTOMATION_SURFACE_FACILITY_ENABLED` / `AUTOMATION_SURFACE_OFFICE_ENABLED` both default
   `false`. A `FACILITY_REGISTERED_ACTION_IDS` allowlist already restricts what CAN ever be
   automation-triggered even once enabled (visitor approve/revoke/expire, maintenance
   assign/complete/cancel today — explicitly excludes device on/off and community/wallet
   approvals).

Facility's own client-side `safeAutomationRuntime.ts` independently computes an
`AutomationExecutionMode` (`suggest_only | prepare_workflow | request_approval | execute_safe`)
per proposed action, purely for shaping conversational-assistant recommendations — **no automation
plan it produces is ever executed against Backend**; it is guidance text only today.

Classification below reflects genuinely-supported-today vs. architecturally-possible-once-the-
facility-surface-flag-is-enabled, not aspiration:

| Domain | OBSERVE | RECOMMEND | APPROVAL_REQUIRED | AUTO_ALLOWED | MANUAL_ONLY | UNSUPPORTED |
|---|---|---|---|---|---|---|
| **Security** (locks/gates/alarms) | ✅ device.read | ✅ assistant text only | — | — | ✅ all actual control | — |
| **Access** (visitor approve/revoke/expire) | ✅ | ✅ | ✅ real registered actions, gated behind `AUTOMATION_SURFACE_FACILITY_ENABLED` (currently off) | — | ✅ until flag enabled | — |
| **Maintenance** (assign/complete/cancel requests) | ✅ | ✅ | ✅ same as Access — registered but flag-gated | — | ✅ until flag enabled | Preventive/recurring maintenance plans, parts/inventory — no data model found |
| **Utilities** | ✅ current reading only | ✅ | — | — | ✅ | Historical trends, meter relationships, billing cycles — no data model found |
| **Environment** | Partial (see Phase 11) | — | — | — | — | Forecast, calibration, waste, sustainability — no provider integration exists |
| **Assets** | — | — | — | — | — | No dedicated asset domain found distinct from devices/infrastructure |
| **Buildings/Homes** (create/assign) | ✅ | — | — | — | ✅ all creation is a direct authorized API call, never automation-triggered | — |
| **Finance** (wallets/services) | ✅ read | — | `safeToExecute()` hard-blocks the financial domain from ever reaching `execute_safe` | — | ✅ | Reporting/export beyond current balance — not confirmed |
| **Community** | ✅ read/moderate | — | `safeToExecute()` hard-blocks this domain too | — | ✅ | Groups/events beyond posts/reports — not confirmed |

**Net finding**: the safety architecture (idempotent ledger, registered-action allowlist,
domain hard-blocks for finance/security/access/visitor/device in `safeToExecute()`) is real and
sound. The gap is entirely at the *enablement* layer (the Facility/Office surface flags) and the
*UI* layer (no Facility settings page exposes any of this as a toggle) — not a missing safety
model. Recommend: keep both flags off until a dedicated automation-enablement phase explicitly
reviews the registered-action allowlist per domain with the business.

## Phase 10 — Contract gap register

Format: UI capability → canonical backend contract → data source → mutation contract → realtime →
intelligence → automation → RBAC → missing contract → priority → recommendation. Compressed to the
gaps actually found (full per-domain coverage of what already works is in the Phase 0 report, not
repeated here).

| Domain | Gap | Priority | Recommendation |
|---|---|---|---|
| **Auth/Tenancy** | Public signup self-provisioned production estates | **P0 — closed this pass** | Done: signup no longer auto-creates an estate; `/facility/estates` restricted to platform roles; Office-driven provisioning is now the sole path. |
| **Auth/Tenancy** | Legacy `POST /invites` had a disabled tenancy check + unrestricted role | **P0 — closed this pass** | Done: real tenancy check + role allowlist enforced. |
| **Team & Access** | No estate-staff invitation endpoint/UI exists at all | **P1** | Generalize the estate-owner invite RPC pattern (this pass) to arbitrary estate-scoped roles, invitable only by an already-authorized estate_admin/facility_manager, gated to roles they themselves may grant (never platform roles). |
| **Settings — My Account** | No password change, no session list/revocation, no MFA | **P1** | Password-change is a straightforward addition (verify current, bcrypt new, matches existing reset-token infra's validation rules). Session revocation needs a real decision: move off pure stateless JWTs (a revocation-checked allowlist/blocklist) or accept 30-day exposure as a documented tradeoff. |
| **Settings — Facility Profile** | Timezone/branding/logo/coordinates editing all explicitly disabled pending backend support | **P1** | Needs real `PATCH /facility/estates/:id` coverage for these fields (currently create-only) plus a logo storage path (Office already has a working generic file-upload pattern to reuse, per its own audit). |
| **Consumer** | No forgot/reset-password flow anywhere | **P1** | Backend already has the full forgot/verify/reset primitive (`/auth/password/forgot` etc, used by Facility) — Consumer just needs the UI, not new backend work. |
| **Consumer** | Invite-activation screen has no "I already have an account" branch | **P1** | Same shape gap this pass just solved for Facility's estate-owner invite — apply the same existing-user branch to Consumer's `/auth/invite` using its own home-invite RPC. |
| **Environment** | No weather/forecast provider, no calibration/waste/sustainability data model | **P2** | See Phase 11 below. |
| **Maintenance** | No preventive/recurring maintenance plan model, no parts/inventory | **P2** | Net-new domain — out of scope for this pass. |
| **Utilities** | No historical-reading/trend/meter-relationship/billing-cycle model | **P2** | Net-new domain — out of scope for this pass. |
| **Finance** | No reporting/export beyond current balance confirmed | **P2** | Not investigated deeply enough this pass to size confidently — flag for a dedicated finance-domain audit. |
| **Deployment/Subscription** | No billing/plan-tier concept anywhere | **P3** | Likely intentionally out of scope until a commercial billing decision is made independent of this trust-chain work. |
| **Automation** | Facility/Office automation surfaces built but disabled; no UI exposes them | **P3** (deliberately not enabled this pass) | Keep off until a dedicated review of the registered-action allowlist. |

## Phase 11 — Weather / geolocation architecture recommendation

**Audit finding**: `estates` already has `lat`/`lng` columns (nullable, unpopulated by any current
UI) and `address` (free text). No `timezone` column exists on `estates` at all. No weather
provider integration exists anywhere in Backend, Facility, or Consumer.

**Recommended contract** (design only, not implemented this pass, per the programme's explicit
instruction not to integrate a weather API yet):

```
Facility (collects lat/lng via the Facility Profile edit gap noted in Phase 10, or a geocode-
  from-address step)
   → Backend WeatherProvider abstraction (a thin interface: getCurrentConditions(lat, lng),
     getForecast(lat, lng, days) -- provider-agnostic, matching the codebase's own established
     pattern of a thin adapter over an external service, e.g. synthesizeOyiSpeech's OpenAI
     wrapper)
   → a single concrete provider implementation behind that interface (provider choice deferred
     to whoever implements this phase -- the point of the abstraction is that the choice is
     reversible)
   → a canonical EnvironmentalObservation shape (temperature, condition, humidity, wind,
     forecast[], observed_at, source: "provider_name") persisted or cached server-side, never
     fetched client-side directly (keeps the API key server-only, matches every other external-
     provider pattern already in this codebase)
   → Facility's Environment domain reads the canonical shape, never the raw provider response
   → Oyi intelligence (the existing corporate/facility conversation orchestrator) can reference
     the same canonical shape for weather-aware recommendations, reusing its existing evidence/
     context-attachment pattern rather than a new intelligence integration
```

The frontend must never hold a provider API key or call a weather vendor directly — this is the
one hard requirement carried over from the prompt ("never tightly coupled to one weather vendor").
Populating `estates.lat`/`lng` (via the Facility Profile edit gap) and adding `estates.timezone`
are the two small, additive prerequisite migrations; both are safe, non-destructive column
additions matching this session's own established migration discipline.
