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
