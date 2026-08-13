# Oyi Evidence Model

Status: Phase A foundation.

## Hierarchy

Oyi intelligence now uses this canonical hierarchy:

1. Raw source record / signal
2. Canonical evidence
3. Intelligence fact
4. Inference / prediction / recommendation
5. Canonical response claim

Canonical evidence is the first source-backed intelligence artifact. It must carry source provenance, object reference, authorized scope, freshness, truth class, confidence, privacy class, permissions and payload.

## Source Of Truth

Contract owner:

- `src/oyi-core/contracts/evidence.ts`
- `src/oyi-core/evidence/EvidenceEnvelope.ts`

Existing domain loaders may continue passing legacy fields through `evidenceEnvelope`; the envelope fills safe defaults. New loaders should provide explicit `source_type`, `source_id`, `truth_class`, `privacy_class` and `permissions`.

## Claim Semantics

Canonical claims must distinguish:

- `confirmed`
- `observed`
- `inferred`
- `predicted`
- `unavailable`
- `unobservable`
- `unsupported`
- `permission_restricted`

Unavailable or permission-restricted evidence must not be promoted into a confirmed or observed success claim.

## Migration Status

- Devices already have the strongest evidence posture and now inherit the enriched envelope.
- Utility, Maintenance, Visitors, Security, Services, Community, Automations and Reports domain modules exist, but direct evidence maturity differs by domain.
- Domain migrations should add explicit evidence metadata before enabling new capabilities.
