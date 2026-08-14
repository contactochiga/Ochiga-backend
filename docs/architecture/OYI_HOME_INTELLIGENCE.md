# Oyi Home Intelligence (Programme 2 / Phase G)

Status: implemented, deployed, behaviorally tested end-to-end.

## What Home Intelligence is

*"What is operationally true, important, abnormal, pending, or relevant
across this home?"* — composed from the mature Programme 1 operational
domains, prioritized by significance, never a dump of every fact and never
just a device count. See `OYI_ROOM_INTELLIGENCE.md`'s architecture diagram —
Home Intelligence uses the identical
contributor -> aggregator -> coverage/attention -> composition pipeline,
just with a wider, home-scoped contributor set and no room target
resolution step.

## Home contributors

`src/oyi-core/domains/roomHome/homeContributors.ts` — ten contributors,
each a thin wrapper around an existing Programme 1 evidence loader (no new
queries invented): devices, security, maintenance, visitors, utilities
(service-account active/linked check only — not usage/balance/meter, which
remain honestly unsupported), wallet (balance + transactions, but the
summary text deliberately never states the balance — see below), services,
automations (definitions + recent failed runs), scenes, community
(official/pinned posts only).

## Regression guard: Home is not a device list

`"How is my home?"` must never degrade to `"13 devices connected..."`. The
composed summary (`roomHomeAnswers.ts`'s `buildAggregateSummary`) leads with
overall state, then the highest-priority attention items across ALL
domains (deduplicated, severity-sorted), then a coverage-gap clause if any
domain could not be checked. A stable home with one open maintenance
request and a failed automation reads: *"Your home is generally stable, but
a few things need attention. AC not cooling: open (high priority). The last
recorded run failed with error code SENSOR_TIMEOUT. Everything else I could
verify looks normal."* — tested directly (`oyi-programme2-room-home-
intelligence-smoke.mjs`, "home summary" check asserts the answer does NOT
match a device-count pattern and DOES surface the maintenance headline).

## Wallet discipline

Wallet only ever becomes an **attention item** when frozen or a transaction
failed — the balance figure itself is deliberately never stated in a broad
Home summary (§45 of the Programme 2 spec). It is still available as a
drill-down: "How much is in my wallet?" resolves through Programme 1's
existing field-answer follow-up once the wallet result set exists, or
through the standalone `wallet.balance.read` capability directly.

## Utility telemetry honesty preserved

`utilities.usage.read` / `.balance.read` / `.meter.read` remain disabled —
no consumption series, maintained per-meter balance, or reading-series
table exists in the schema (proven in the Programme 1 audit, re-confirmed
here, not re-litigated). The Home utilities contributor only ever reports
active/linked status from `home_service_accounts`, never invents a
consumption number. A question requiring missing telemetry
(e.g. "how much electricity have I used") is answered honestly as
unavailable by the existing `utilities.usage.read` stub — Home Intelligence
does not attempt to derive it from spending.

## Coverage model

`aggregateContract.ts`'s `CoverageSummary`:
`{requested, answered, empty, degraded, unavailable}`, counted directly from
each contributor's `ContributorStatus`. Never phrased as "everything is
fine" when coverage is incomplete — `coverageGapClause` names exactly which
domain(s) could not be confirmed, appended to every summary that has a gap.
A genuine critical/warning finding always still surfaces even alongside a
coverage gap in a different domain (`overallStateFor` in
`aggregateContract.ts`: a real severity finding always wins over "partial";
"partial" only applies when nothing alarming was found in what COULD be
checked).

## Freshness reconciliation

`contributorSummary.ts`'s `classifyFreshness` applies **per-domain**
thresholds, not one global timeout: devices need near-live freshness (15
min "fresh" / 6h "recent"), maintenance/visitors/community/utilities/
services tolerate a day/week, wallet facts are always "historical" (they
are ledger entries, not state that goes stale).

## Severity / attention model

Reuses (does not duplicate) `contributorSummary.ts`'s existing
`ContributorSeverity` scale (`none|info|attention|warning|critical`),
aligned with the already-established `CanonicalTruth.severity` vocabulary
(`canonicalConversationTruth.ts`) rather than the separate signal-based
`contextAwareness.ts` engine — that engine lives in a different,
non-capability-pipeline conversation runtime (`runtime/conversation.ts`,
not `ConversationOrchestrator.ts`) that Programme 1/2 do not run through, so
bridging it would have meant crossing pipelines rather than reusing one.
Documented here as a deliberate choice, not an oversight.

Deterministic priority order for attention items (highest first):
security/safety, critical incidents, utility/infrastructure disruption,
high-priority maintenance, device failures, access/visitor issues,
automation failures, financial/service attention, community updates —
implemented via each contributor's own `severityFor` callback plus
`maxSeverity`/sort in `aggregateContract.ts`, not a second scoring engine.

## Attention deduplication

`dedupeAttentionItems` collapses attention items that resolve to the exact
same canonical object (`object_type:canonical_id`) across contributors,
keeping the highest-severity entry — verified directly
(`oyi-programme2-room-home-intelligence-smoke.mjs`). Genuinely distinct
objects are never collapsed, even within the same domain.

## Multi-domain result sets (the key Programme 2 architectural addition)

Programme 1's result-set persistence assumed one domain per turn. A Home
summary can legitimately surface maintenance + an automation failure + an
expected visitor in a single turn. `oyi_conversation_threads.metadata` now
stores `result_sets: {domain: ResultSetContext}` (a map, not a single
overwritten slot — this replaced Programme 1's earlier single-slot
`last_result_set`/`active_domain` design) plus `active_domain`. A
Room/Home capability's `DomainResult.metadata.result_set` can be an ARRAY
of per-domain result sets in one turn; `persistCanonicalConversationTurn`
merges each into the map by its own domain. `followUpResolver.ts`'s
`parseDomainSwitchIntent` was broadened from only "go back to X" to also
recognize "tell me about the automation" / "what about the maintenance
issue?" — any follow-up that names a domain now resolves against THAT
domain's own result set, not just whichever was "active." A bare "tell me
about that" (no domain named) still uses the single active domain exactly
as Programme 1 built it — this is additive, not a replacement.

Each per-domain result set is built from that contributor's
**attention items** when it has any (the objects actually narrated in the
summary), falling back to the full fact list otherwise (e.g. a Room status
answer's full device list, for "tell me about the second one").

## Home capabilities

- `home.summary.read` (promoted from a `declared`/`shadow` stub) — "How is
  my home?"
- `home.attention.read` — "What needs my attention?" / "Is everything
  okay?"
- `home.activity.read` — "What happened today?" / "What happened
  overnight?" (uses `loadRecentDeviceChangeFacts` instead of full
  inventory for the devices contributor; other domains' facts are already
  recency-ordered by their own `.order()` clause)

## Privacy

Every contributor re-derives `estate_id`/`home_id` from the current
authenticated turn on every call. A resident's Home Intelligence answer can
only ever see their own home's maintenance/visitors/wallet/automations —
no aggregation-level authorization shortcut was introduced; each
contributor still calls the SAME scoped Programme 1 loader that already
enforces this.

## Performance

All applicable contributors run in parallel (`Promise.all` in
`runContributors`), each wrapped in its own try/catch so one failing
contributor never fails the whole answer (verified directly — see the
"home partial coverage" test). Per-contributor and total aggregate latency
are logged (`oyi_room_home_aggregate_completed`). Evidence returned to the
capability pipeline is bounded to 30 facts (attention items first), not
every row from every domain.
