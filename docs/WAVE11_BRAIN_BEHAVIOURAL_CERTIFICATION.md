# Wave 11 brain behavioural certification — isolated fixture run

## Result

**BRAIN NOT YET CERTIFIED.** The existing 100-turn harness now invokes the real canonical `ConversationOrchestrator` against a disposable local Supabase stack. It no longer reports all turns as infrastructure-blocked. The first executable run exposed structural capability, evidence and workflow failures; HTTP 200 and a persisted fallback do not count as success. No production database, deployment, or authoritative branch was changed.

## Isolation and schema

- Local Supabase project `wave11-behavioural-fixture`: API `http://127.0.0.1:55421`, database port `55422`, separate from the pre-existing local stack and production. Live mode refuses every other URL, including the production project reference. The refusal was tested.
- Live mode requires `OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY`, replaces the generic service-role variable with it in-process, and refuses configured external communication/device execution credentials. No key or connection URL is written to the repository or result files.
- Clean replay: `migrations/schema.sql`, retained May foundation, `supabase/baselines/verified-production-prerequisites.sql`, all 119 tracked migrations in order (May applied once), then `supabase/baselines/verified-production-compatibility.sql`. PostgreSQL replay succeeded. This is the existing production-derived baseline, not a second test schema.
- `scripts/wave11-behavioural-fixture-seed.sql` adds only synthetic data to the disposable DB and is deliberately outside `supabase/migrations`.
- Queue/Redis transports are isolated in-process; Core, registry, authority, Supabase persistence and evidence readers are not mocked.

The fixture includes one estate, three homes across two towers, four rooms, four devices with online/offline/stale state, one camera, two maintenance requests, two visitors, and a test wallet with two transactions. Synthetic actors are public Osa, Office admin, Facility manager/staff, and Residents A/B in different homes. Office snapshots include synthetic leads, opportunity, report, task, meeting, support case, partnership, document and content. There is no customer data or external-action credential.

## Executable 100-turn baseline

The original 25 four-turn journeys remain unchanged and score 66 PASS / 34 FAIL. The same harness also ran 32 supplemental turns across Office lead/draft, public JV discovery, Facility overview, Consumer device/action continuity, and Resident B cross-home privacy journeys (18 PASS / 14 FAIL). All run sequentially by thread through the production Core entry contract. Machine-readable JSON and Markdown summary are local at `/tmp/wave11-live-behavioural-torture.json` and `/tmp/wave11-live-behavioural-torture.md`.

| Surface | Turns | PASS | FAIL | BLOCKED |
| --- | ---: | ---: | ---: | ---: |
| Public/Osa | 23 | 9 | 14 | 0 |
| Office/Oma | 31 | 21 | 10 | 0 |
| Facility | 27 | 18 | 9 | 0 |
| Consumer | 51 | 36 | 15 | 0 |
| **Total** | **132** | **84** | **48** | **0** |

All 132 turns reported `persistence_saved: true` in the isolated DB. Resident B in A-102 did not receive A-101 device, visitor or wallet records in the four cross-home probes. This establishes those tested boundaries, not full follow-up or privacy coverage. Unsupported answers are not marked PASS merely because they returned a response.

## Failure inventory and repair

- **P0:** No external send, device mutation or privacy disclosure was observed. This is not proof of all authority boundaries: external action execution and every adversarial identity pairing are not yet exercised.
- **P1, brain:** The baseline includes 13 capability-selection and six workflow failures. Facility-wide “what needs attention?” resolves to Consumer Home attention and is surface-restricted. Facility overview/offline-camera requests often fall to unsupported. Consumer “suggest an automation” selects list/read. “Turn the second device off” after wallet history now enters `devices.power.control` and asks for the exact device rather than reading a wallet transaction or guessing a target. The seven-turn public JV journey failed all seven turns, usually reaching generic fallback instead of progressive qualification. Office drafting, Consumer cancellation/recurrence, and natural “what did I just ask?” continuity remain incomplete.
- **P1, worker/evidence:** 15 evidence failures. Live visitor reads initially failed because `visitor_access` has no `updated_at` column; the query was corrected. Device state snapshots were added to the fixture. Utility usage and report period summary are explicitly disabled, not fabricated. Other unavailable evidence remains separately visible in the JSON record.
- **P2:** Conversational continuation, qualification and persona quality need re-scoring after structural failures.

Confirmed narrow repairs: the visitor query now matches the schema; “tell me about the second one” remains a CRM detail read rather than an email proposal; explicit “go back to devices” recognizes the device domain; target-first device commands map to the governed power capability, while an ordinal inside a mutation is not hydrated as a read from an unrelated active result set. With no verified target, the command asks for clarification and does not execute.

## Validation and limits

| Check | Result |
| --- | --- |
| Backend `npm run typecheck` and `npm run build` | PASS |
| `node scripts/wave11-intent-capability-contract-smoke.mjs` | PASS — 34 classes and new parser guards |
| `node scripts/wave11-terminal-persistence-guard-smoke.mjs` | PASS |
| `node scripts/communication-runtime-smoke.mjs` | PASS, with expected invalid placeholder-key logging in its isolated smoke |
| Clean local baseline and migration replay | PASS |
| Production-target refusal | PASS |
| Live 132-turn harness, including unchanged 100-turn baseline | 84 PASS / 48 FAIL / 0 BLOCKED; baseline 66 PASS / 34 FAIL; intentionally exits nonzero |
| External action execution/verification | BLOCKED — no approved isolated sinks/adapters |

Next: fix the preserved P1 Facility overview, public JV qualification and continuity/evidence records in the existing canonical layers; rerun all 100 unchanged turns and the 32 supplemental turns. Isolated action sinks are still needed before safe execution/verification can be certified. No merge or deployment is authorized by this result.
