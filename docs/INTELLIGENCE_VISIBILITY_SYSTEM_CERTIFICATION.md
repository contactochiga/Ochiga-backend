# Intelligence Visibility System — Certification

Branches: Backend and Office `codex/intelligence-visibility-slice1` (Slices 1–7 + final hardening).
Bases: Backend `origin/main` @ `87066cd`; Office `origin/codex/office-extraction` @ `de392d8` (repository default).
Status: certified on the isolated Wave 11 fixture. **Not merged, not deployed; trace migration not applied to production.**

## 1. Purpose
Office → Intelligence lets internal staff (Office `view_traces` / Backend export key) observe how the
single Oyi Core behaves — what it can do, what it is doing, what needs a human, what it remembers and
learns, and how each turn was decided — **without** becoming a second intelligence, a data browser, or
a control surface. Every page is a read model over existing canonical truth.

## 2. One-Core architecture
There is one Oyi Core (`ConversationOrchestrator`, capability registry, authority, evidence,
workflow/action/goal/decision runtimes). Oma (Office), Osa (public/corporate), Facility and Consumer are
governed *surfaces/workers* of that Core, not separate brains or processes. Intelligence never calls an
authority or mutation path; it reads projections only (static guard: `intelligence-visibility-final-audit-smoke`).

## 3. Information architecture (nine sections)
| Section | Status | Source |
| --- | --- | --- |
| Overview | LIVE | `/intelligence/overview`, `/interventions`; compact Recent Activity + System Health; compact canonical-turn panel |
| Workers | LIVE | `/intelligence/workers[/:worker]` (registry projection, interventions, cross-surface events, canonical traces) |
| Activity & Trace | LIVE | `/intelligence/traces[/:id]` + full Activity Analytics (Office traces + `/observability/events`) |
| Oyi Capabilities | LIVE | `/intelligence/capabilities`, `/summary` (registry introspection) |
| Knowledge | LIVE | `/intelligence/knowledge[/:key]` (canonical knowledge index, Office staff authority) |
| Goals & Decisions | LIVE | `/intelligence/goals[/:id]`, `/decisions[/:id]` |
| Actions & Workflows | LIVE | `/intelligence/actions[/:id]` (workflows, communications, automation approvals, device commands) |
| Memory & Context | LIVE | `/intelligence/memory-context` (aggregate/structural only) |
| Learning | LIVE | `/intelligence/learning` (mechanism status, parameters, evidence) |
No placeholder is reachable for any of the nine sections.

## 4. Backend contracts
18 routes, all `GET`, all behind `requireOfficeExportKey`; Office proxies them 1:1 under
`/api/lead-agents/admin/intelligence/*`, `GET`-only and `view_traces`-gated. Contracts carry
`available` / `complete` / per-source status; zero is never used to mean unavailable, and a status
(e.g. "not implemented") is never rendered as an outage.

## 5. Privacy model
Read projections are allow-listed: no prompts, replies, messages, drafts, recipients, communication
bodies, memory contents, result-set records, opportunity facts, raw evidence, actor/home/device/thread
identifiers, credentials, system instructions or error messages. Memory & Context and Learning are
aggregate/structural. Knowledge enforces canonical knowledge authority. Traces are a sanitized
projection with keyed pseudonymous references. Proven by sentinel sweeps across all nine sections
(final audit: 63 responses, 14 sentinels, 9 cross-home/identity values, zero leaks) and by the trace
privacy torture (DB rows, JSONB, list/detail APIs, rendered UI — zero leaks).

## 6. Worker model
Four governed workers mapped from surfaces (consumer, facility, office_internal→Oma,
public_corporate→Osa). Worker metrics are real counts (capabilities, pending interventions,
cross-surface events, canonical turns, no-match/terminal, failures, median latency only when n ≥ 20).
No uptime, no synthetic "intelligence score".

## 7. Capability visibility
Registry introspection (rollout status, surfaces, risk/confirmation policy, read vs action shape).
Metadata visibility is not execution authority; capability authority is unchanged.

## 8. Intervention model
Five real human-intervention sources (automation approval, goal escalation, decision, workflow gate,
communication confirmation); the conversation-proposal source is declared as not platform-listable
rather than silently omitted.

## 9. Goals & Decisions
Real GoalRuntime/DecisionStore read accessors; structural conditions and lineage only.

## 10. Action / workflow truth
One cross-source list with canonical status preserved beside a presentation stage; device-command
truth (request/dispatch/provider/confirmation/physical-effect/final) shown in full and never collapsed
into "success". Visibility only — no approve/confirm/cancel controls.

## 11. Knowledge governance
Enumeration and detail run under `OFFICE_INTERNAL_KNOWLEDGE_ACTOR` (office_internal,
INTERNAL_COMMERCIAL) through the canonical audience/agent gate; forbidden and nonexistent keys return an
identical 404; `do_not_state_verbatim` statements are withheld; corpus-wide aggregates cover governance
labels only.

## 12. Memory & Context restrictions
Head-count queries only. Ten context types with TTLs from their owning modules. Resident memory: read
path active; governed admission (`writeScopedMemory`) **not wired**; the legacy `/ai/chat` writer is
**active without admission** — shown as "Not governed", never as learning preferences.

## 13. Learning honesty
Evidence collection active; parameter proposals config-gated (off by default); human promotion
inactive/unwired; automatic promotion and model training not implemented; behaviour changes only at
`rollout_stage = enabled`. The pipeline UI visibly stops at Promotion. Safety boundary shows the real
enforced namespaces/forbidden terms.

## 14. Durable Trace architecture
One sanitized record per `ConversationOrchestrator.run()` (see `docs/INTELLIGENCE_CONVERSATION_TRACE.md`).
Single finalization boundary around `runTurn()` (return + throw); single writer; synchronous,
non-throwing, never awaited; failures observable and never claimed saved; graceful-shutdown flush ≤ 2s.
Only the 12 actually-emitted stages are stored; the Wave 11 terminal taxonomy is applied at the
projection boundary. Exactly-once proven: 132-turn corpus → 132 traces, 132 distinct.

## 15. Trace retention
`OYI_TRACE_RETENTION_DAYS` (default 30; range 1–365) stamped as `expires_at`; expired rows excluded from
reads; worker-process cleanup in bounded batches of 500 (`OYI_TRACE_RETENTION_ENABLED`,
`OYI_TRACE_RETENTION_INTERVAL_MS`), retention query served by `idx_oyi_conversation_traces_expires`.

## 16. Trace pseudonymization
Thread/turn references are HMAC-SHA256 with `OYI_TRACE_REFERENCE_KEY` (≥ 32 chars). There is **no**
unkeyed fallback: without a usable key recording is `unconfigured`, nothing is persisted, the
degradation is observable (metric + log + API/Overview status), and conversations are unaffected.

## 17. Performance (local isolated fixture, medians)
| Endpoint | ms | Endpoint | ms |
| --- | ---: | --- | ---: |
| summary | 1 | knowledge (cached index) | 1 |
| capabilities | 1 | knowledge detail | 0 |
| overview | 16 | memory-context | 22 |
| interventions | 6 | learning | 22 |
| workers | 7 | traces list / filtered | 4–5 / 4 |
| worker detail | 7 | trace detail | 5 |
| goals | 3 | actions | 4 |
| decisions | 2 | action detail | 4 |
Trace write: ~4–5 ms, after the response (conversation median with/without trace persistence within
noise: 38–39 ms vs 35–39 ms). No measured endpoint concern on the fixture.

## 18. Known debt
- Memory & Context active-context counts scan `oyi_conversation_threads` (no standalone `updated_at`
  index); bounded per query, database-side, but unindexed at scale.
- Knowledge first load after cache expiry includes one Office knowledge-pack HTTP call (5-min TTL).
- Trace persistence is best-effort; a process calling `process.exit()` directly can drop its final write.
- No action-id → Slice 4 device-command link from traces yet (mapping not established).
- Goal/decision detail routes not exercised live on the fixture (no goals/decisions seeded); covered by
  Slice 4 structural tests.
- Pre-existing failures unrelated to Visibility (identical on `87066cd`): `execution-ledger` (fixture
  uses non-UUID `"estate-1"`), `oyi-workflow-durable-continuation`, `oyi-workflow-action-phase-c-reload`,
  `-correction`, `-multigang`, `oyi-office-intelligence-convergence`.
- Wave 11 corpus: 131/1/0 — the one failure is the certified, honestly declared `utilities.usage.read`.

## 19. Validation
Backend typecheck/build; Slice 1–7 smokes; trace contract (11), live (11), final audit (5); Wave 9
knowledge/memory/context/ownership; Wave 11 terminal-persistence/opportunity/intent-contract and 132-turn
corpus; learning/outcome (Wave 8 slices 1/3/4/5/6, programme 4); One-Core (`intelligence-authority`,
`oyi-core-convergence`); device/IR/canonical truth; workflow/action runtime; socket matrix `--guarded`
(20/20); clean fixture replay (125 files, 0 failures); production-target refusal; `git diff --check`;
changed-diff secret scan. Office check/lint/build/security/architecture guard; full UI review at
1440/1024/768/390 across nine sections and detail pages (no placeholders, `[object Object]`,
`undefined`/`NaN`, truncated canonical labels, overflow, console errors or unexpected failed calls).

## 20. Deployment requirements
- Backend env: **`OYI_TRACE_REFERENCE_KEY`** (required for trace recording; secret, ≥ 32 chars).
  Optional: `OYI_CONVERSATION_TRACE_ENABLED` (default true), `OYI_TRACE_RETENTION_DAYS` (30),
  `OYI_TRACE_RETENTION_ENABLED` (default on, worker), `OYI_TRACE_RETENTION_INTERVAL_MS` (3600000).
- Office env: none new (paths default; optional `OFFICE_INTELLIGENCE_*_PATH` overrides).
- Database: apply `supabase/migrations/20261001120000_intelligence_conversation_traces.sql` **before**
  the Backend deploy that writes traces (writes fail safely and observably if the table is absent).
- Order: migration → Backend (web + worker) with `OYI_TRACE_REFERENCE_KEY` → Office.

## 21. Rollback
- Office: revert/redeploy previous Office build; Backend contracts are additive, so older Office is unaffected.
- Backend: set `OYI_CONVERSATION_TRACE_ENABLED=false` to stop trace writes immediately (no restart of
  logic needed beyond env reload); redeploy the previous Backend to remove the routes and finalizer.
- Database: the trace table is additive and independent; it can remain (retention expires rows) or be
  dropped (`drop table public.oyi_conversation_traces`) after Backend rollback. No other table changed.
