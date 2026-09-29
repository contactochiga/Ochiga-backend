# Wave 11 brain behavioural certification

## Executive result

**BRAIN NOT YET CERTIFIED**

The Wave 11 contract hardening changes are built and regression-guarded, but
the first 100-turn harness run is intentionally **BLOCKED** for end-to-end
behaviour: this checkout has no approved isolated Supabase test fixture and no
`OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY`. No blocked result is counted as a pass.

## Candidate and branch

- Starting authoritative Backend main: `5e3c53d5ee46067cb98c6291a1a3d9fb0eb2b1fc`
- Wave 11 branch: `codex/wave11-brain-behavioural-hardening`
- Contract/persistence hardening: `cad4a206a47ae85b498783c9ea8d3ec380bd8709`
- Behavioural harness: `124a265` (this document is added by the next commit)
- Production changes: none.

## Semantic → capability result

The parser/registry contract is documented in
[`WAVE11_INTENT_CAPABILITY_MATRIX.md`](WAVE11_INTENT_CAPABILITY_MATRIX.md).
The executable smoke covers 34 distinct parser classes across Consumer,
Facility, Office and public-corporate surfaces.

Fixed P1 parser/predicate defects:

1. Broad Home wording such as “What’s happening at home?” now resolves to
   `home.summary.read`, rather than an unclaimed `home/summarize` frame.
2. Plural `rooms` now classifies as `rooms`.
3. Plural `visitors` now classifies as `visitors`.

Known honest non-enabled routes are classified as `declared_disabled`, not as
missing capabilities: utility usage and period reports.

## Persistence result

The canonical writer remains the sole authority:
`persistCanonicalConversationTurn()`.

Before Wave 11, the normal orchestrator persisted only when
`capabilityOwnsResponse` existed. Canonical unsupported/no-match and
business-surface fallback responses could therefore return with
`persistence_saved: false` without attempting persistence.

After Wave 11, the normal route has exactly one branch:

```text
capability-owned response → established capability persistence lifecycle
terminal canonical response → terminal lifecycle → same canonical writer
```

The terminal lifecycle records an honest `general_help` request contract; it
does not create a fabricated registry key or a second persistence store.
Writer failure remains explicit as `persistence_saved: false`.

## Observability result

New canonical telemetry:

- `canonical_terminal_response` trace stage
- `oyi_conversation_terminal_outcome_total`
- outcome labels including `capability_no_match`,
  `canonical_unsupported`, and `business_surface_fallback`

Legacy-named fields/counters remain compatibility metadata only. New canonical
terminal responses no longer claim that a retired general-chat runtime answered.

## 100-turn torture harness

`scripts/wave11-behavioural-torture-harness.mjs` defines 25 four-turn
journeys (exactly 100 conversational turns) across:

- public/Osa product, JV, privacy and injection journeys;
- Office/Oma leads, opportunities, reports, communications, tasks and
  operations journeys;
- Facility overview, cameras, visitors, maintenance, utilities and action
  safety journeys;
- Consumer home, room/device, wallet, visitors, automations, memory,
  corrections, ambiguity and cross-domain journeys.

It records every required contract field in JSON and produces a Markdown
summary. The initial preflight output is deliberately written under `/tmp` and
contains 100 `BLOCKED` records because no approved isolated data fixture exists.

### Blocked condition

| Layer | Status | Exact reason |
| --- | --- | --- |
| Evidence/worker reads | BLOCKED | No isolated Supabase fixture or approved local service-role key. |
| Conversation persistence | BLOCKED | Same fixture is required to verify stored messages and thread continuity. |
| Action confirmation/execution | BLOCKED | No isolated action fixture; real-world actions are forbidden. |
| Quality/persona scoring | BLOCKED | It depends on actual evidence-backed canonical responses. |

## Failure inventory and priority

### Fixed

| Layer | Finding | Result |
| --- | --- | --- |
| Capability selection | Broad Home summary had no matching predicate. | Fixed. |
| Interpretation | Plural rooms/visitors were not classified. | Fixed. |
| Persistence | Terminal canonical turns omitted the persistence lifecycle. | Fixed in code; live fixture verification pending. |
| Observability | Canonical fallback was labelled legacy. | Canonical taxonomy added; compatibility fields retained. |

### P1 candidates requiring an isolated end-to-end run

| Layer | Candidate | Why it is not yet called a defect |
| --- | --- | --- |
| Capability selection | Facility-wide “what needs attention?” can syntactically match Consumer-only Home predicates. | The harness has no persisted Facility context, so the real orchestrator’s context/follow-up logic has not been evaluated. |
| Context/follow-up | Office ordinal/pronoun turns require an actual persisted result set. | The preflight intentionally has no database. |
| Worker evidence | Cameras, utilities, home summaries and CRM require authorised fixture data. | No data fixture is available. |

## Validation run

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `node scripts/wave11-intent-capability-contract-smoke.mjs` | PASS — 34 parser/capability classes, no DB/provider/action access. |
| `node scripts/wave11-terminal-persistence-guard-smoke.mjs` | PASS — single writer and canonical telemetry guard. |
| `node scripts/wave11-behavioural-torture-harness.mjs` | BLOCKED — 100 recorded turns; isolated fixture absent. |
| `node scripts/business-surface-capability-smoke.mjs` | BLOCKED — this checkout lacks a valid Supabase URL/configuration for that runtime smoke. |

## Next executable action

Provide an approved isolated Supabase fixture and a local-only service-role key
through the existing approved secret source, then run:

```bash
cd /tmp/oyi-wave10-landing.uWVUTt
OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_URL=... \
  node scripts/wave11-behavioural-torture-harness.mjs
```

The runner must be extended only to invoke the existing canonical surface
transport with those identities; it must not use production credentials or
execute real-world mutations.

## Certification decision

**BRAIN NOT YET CERTIFIED** — the remaining blocker is one concrete test
infrastructure requirement: an approved isolated runtime fixture for the
100-turn end-to-end journey run. No production migration, deployment, merge or
One-Core architecture change is required for this result.
