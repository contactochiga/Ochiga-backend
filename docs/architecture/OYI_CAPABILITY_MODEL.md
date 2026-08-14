# Oyi Capability Model

Status: Phase B executable read-capability foundation.

## Principle

There is one Oyi capability system. Consumer, Facility, Office, Public, Voice, Vision, Watch and Edge are surfaces or channels over the same capability fabric.

## Contract Owner

- `src/oyi-core/contracts/capability.ts`
- `src/oyi-core/capabilities/CapabilityRegistry.ts`
- `src/oyi-core/capabilities/CapabilityRollout.ts`
- `src/oyi-core/capabilities/CapabilityService.ts`
- `src/oyi-core/capabilities/ReadCapabilityModules.ts`

## Capability Definition

The final capability shape is represented by `OyiCapabilityDefinition`. It defines:

- key
- domain
- operations
- supported surfaces
- scope requirements
- permission requirements
- risk class
- confirmation policy
- evidence requirements
- resolver
- read/draft/execute/verify handlers
- workflow definition
- presentation policy
- rollout status

## Enabled Capability Rule

Enabled capabilities must be executable. A read capability with rollout status `enabled` must have resolver support, evidence requirements, a real evidence loader, authority checks, a read handler, structured result status, and presentation policy. Consequential or sensitive capabilities that execute must also provide confirmation and verification; Phase B does not enable new mutations.

## Rollout Status Meaning

- `declared`: vocabulary exists, implementation incomplete.
- `implemented`: code path exists, but not yet proven as enabled runtime owner.
- `integration_tested`: integration tests pass but not enabled for production ownership.
- `shadow`: may be evaluated or observed without owning responses/actions.
- `enabled`: may own production conversation requests.
- `disabled`: explicitly unavailable.

## Phase B Enabled Reads

- `global.capabilities.read`
- `devices.status.read`
- `devices.availability.read`
- `devices.activity.read`
- `devices.failures.read`
- `devices.diagnosis.read`
- `devices.relationships.read`
- `devices.capabilities.read`
- `wallet.transactions.read`
- `utilities.spending.read`

All other registered domain reads remain below `enabled` until direct evidence and authority are proven.

## Runtime Selection

Canonical conversation routing now asks `CapabilityService.resolve(...)` before legacy fallback. Enabled, authorised read capabilities own the turn through their handler. Non-enabled or unsupported capabilities fall back with an explicit `oyi_capability_legacy_fallback` reason.

`What can you do?` uses `CapabilityService.listForActor(...)`, filtered by surface, actor, role, scope, rollout status, and authority.

## Phase B Correction

Enabled read capabilities now finalize through the canonical conversation persistence owner, `persistCanonicalConversationTurn(...)`, after the capability handler produces a structured result. The capability system does not insert conversation messages directly and does not own a separate History store.

Capability selection is exact by semantic operation. If a user asks for `utilities.active.read` and that capability is not enabled, Oyi records a measured fallback/unsupported path; it must not substitute `utilities.spending.read` merely because spending is enabled in the same domain.

Wallet transaction reads use the authorised home wallet relationship as evidence scope, then load matching transaction rows by wallet ID and/or home ID. Generic wallet history and typo-normalized transaction prompts share the same historical evidence path and keep empty, unavailable and permission-restricted outcomes distinct.

## Phase B Final Correction

Resolved capabilities below `enabled` now produce a canonical safe fallback response instead of falling through to a generic runtime failure. The fallback preserves the exact semantic capability key, rollout status, reason and fallback owner; nearest-enabled same-domain substitution remains forbidden.

## Programme 4 Phase D — Capability Truth Closure

Audited every hand-written capability/authority list outside `CapabilityRegistry.ts`/`CapabilityService.ts` for drift risk, following Programme 4's routing unification (all conversation-turn surfaces now enter through `ConversationOrchestrator` — see `OYI_INTELLIGENCE_PERMANENT_SITE.md`/Phase B notes).

**`src/oyi-core/runtime/domainCapabilityRegistry.ts` (`DOMAIN_CAPABILITIES`, pipeline-2-only authority table).** Initially assumed to be a corporate/office-specific gap-filler; direct comparison against the registered `domain:` keys in `ReadCapabilityModules.ts` + `DeviceActionCapabilityModules.ts` + `roomHomeCapabilities.ts` + `intelligenceCapabilities.ts` shows this is wrong — it duplicates all 15 domains `CapabilityRegistry` already natively covers (`home, rooms, devices, visitors, security, maintenance, wallet, utilities, services, community, messages, scenes, automations, reports, global`), using a structurally different authority vocabulary (`authority_tier`/`requires_approval` arrays vs. `confirmation_policy`/capability-module `status`). Because `ConversationOrchestrator` is tried first for every surface (Phase B), this duplication is reachable only through the `LegacyConversationAdapter` fallback — i.e. only when a turn's domain matches one of the 15 overlapping domains but no native capability module actually resolves it (wrong surface, unimplemented operation, etc.). It is not first-line duplicate authority today, but it is latent duplicate authority: if that fallback fires for a mutation-capable domain (devices, wallet, visitors...), the turn is governed by a different, less rigorous rule set than the one that would have applied natively. Retiring the 15 overlapping entries requires proof (via Phase J's fallback-usage counters) that native capability resolution never actually fails for those domains in production — not done in this pass, flagged for a future Phase O decision once that evidence exists.

Five domains have **no native capability module at all**: `access, transactions, cameras, notifications, incidents`. For these, `domainCapabilityRegistry.ts` is the sole capability truth, reachable via the same fallback path. Building native capability modules for these is new implementation, not cleanup — `access`/`cameras` in particular touch security-sensitive surfaces (unlock, credential display, live view) that shouldn't be rushed to close an audit checkbox. Left as a documented gap, not built in this programme.

**`src/contracts/corporateIntelligence.ts` (`PUBLIC_CORPORATE_SURFACE_POLICY`).** Not a duplicate of operational capability truth — it's a surface-safety deny-gate for the unauthenticated public-corporate surface (`allowed_capabilities` are corporate-conversation features like `crm_intake_create`, not Consumer/Facility operational domains; `blocked_operational_domains`/`blocked_actions` block device/access/security/visitor operations outright before any capability resolution runs). Structurally appropriate to keep separate from `CapabilityRegistry` since it governs a fundamentally different actor class (anonymous public visitor vs. authenticated resident/staff). No action needed.

**`src/ai/toolRegistry.ts` (`AI_TOOL_REGISTRY`).** Tied to the second action-execution authority (`ai/commandRouter.ts`, its own ledger `ai_execution_ledger`), not a standalone capability-truth duplicate. Resolution belongs with Phase F (action/workflow single authority), not here — flagged for that phase rather than addressed twice.

**`src/controllers/cameraIntelController.ts::getAnalyticsCapabilities()`.** Hardware analytics feature list (face recognition, person detection) for camera devices — a different domain (device hardware capability) from Oyi conversational capability truth. No action needed.

**Verdict:** capability truth is unified for the 15 domains `CapabilityRegistry` covers, on the primary (non-fallback) path, across all surfaces after Phase B's routing migration. It is not yet fully unified for the 5 gap domains or for the fallback path's authority vocabulary — both are documented, bounded, measurable gaps rather than silent drift, consistent with Programme 4's principle of not expanding non-device implementation mid-programme.

Capability advertising remains sourced from `CapabilityService.listForActor(...)`, but presentation metadata no longer attaches unrelated generic Home update cards/actions. Capability-owned source metadata is deduplicated and labelled for resident presentation while preserving internal evidence references.
