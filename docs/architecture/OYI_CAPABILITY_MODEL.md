# Oyi Capability Model

Status: Phase A foundation.

## Principle

There is one Oyi capability system. Consumer, Facility, Office, Public, Voice, Vision, Watch and Edge are surfaces or channels over the same capability fabric.

## Contract Owner

- `src/oyi-core/contracts/capability.ts`
- `src/oyi-core/capabilities/CapabilityRegistry.ts`
- `src/oyi-core/capabilities/CapabilityRollout.ts`

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

Enabled capabilities must be executable. A capability with rollout status `enabled` must have at least one executable adapter. Consequential or sensitive capabilities that execute must also provide verification.

## Current Migration Status

The existing `CapabilityModule` interface remains compatible with earlier adapters while exposing the new fields as optional. This prevents a second registry and allows domains to migrate progressively.
