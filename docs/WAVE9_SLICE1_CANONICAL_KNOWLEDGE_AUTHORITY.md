# Wave 9 — Knowledge, Memory & Agent Capability Convergence
## Slice 1 — Canonical Knowledge Authority & Retrieval Contract

STATUS: Implemented locally. Not pushed. Not deployed. Wave 9 Slice 2+ not started. OMA/OSA prompt files were not modified.

---

## 1. Semantic boundaries (locked)

Per the mission brief, held strictly throughout this slice's design and code:

- **KNOWLEDGE** — durable, approved institutional/domain understanding. Modeled here as `KnowledgeItem` (`knowledgeContracts.ts`).
- **MEMORY** — retained context from prior interactions (`lead_memories`, `resident_memory`). Not touched by this slice — no read, no write.
- **LIVE STATE** — authoritative current operational truth (Wave 5/6 device/camera state, Office CRM truth). Not touched. Knowledge items may *explain* what a state concept means; they never assert or replace a live value.
- **CONTEXT** — the caller-supplied assembly (message, agent role, business unit) used to *query* the retrieval contract. Modeled as `RetrieveKnowledgeRequest`.
- **PROMPT** — behavioral/role instruction. `agent-voice-and-style.md` is deliberately excluded from the retrievable knowledge corpus for exactly this reason (see §5).
- **CAPABILITY / AUTHORITY** — untouched; no new agent capability was added this slice (per the brief's own "do not build new agent capabilities yet").

## 2. Scope of this slice

Implemented: a canonical knowledge item contract, an authority/domain taxonomy, a classification manifest for Office's real 27-file `knowledge/` pack, a Backend→Office read-only bridge, an in-memory retrieval service with authorization/ranking/bounding, and ONE live wiring point (`/conversation/corporate` and `/conversation/internal`'s `knowledge_references` field). Not implemented: memory integration, knowledge ingestion beyond the Office pack, Facility/Consumer migration, any change to Oma/Osa's actual answer-generation text.

## 3. `knowledge_context` defect — reproduced and closed

Traced end-to-end this slice (extending Slice 0's own partial trace):

- Office's `oyi-core-gateway.js` sends every corporate conversation request with `knowledge_context: Array.isArray(safeBody.knowledge_context) ? safeBody.knowledge_context : []` — always empty in practice, since nothing in Office ever populates it.
- Backend's real, typed contract (`CorporateKnowledgeReference = {id,title,excerpt,source}`, `contracts/corporateIntelligence.ts:110`) already existed on both request and response shapes — pre-built, never fed real data.
- Backend's own consumption of the inbound field, before this slice: `corporatePublicConversationPolicy.ts`/`corporateOfficeInternalPolicy.ts` echoed `request.knowledge_context` straight into the response's `knowledge_references` field. Since the input was always `[]`, the output was always `[]`. **The defect was confirmed on both sides of the wire, not assumed.**
- **New finding this slice**: `OfficeCorporateCapabilityModules.ts` (2,869 lines, not covered by Slice 0's Backend fork) contains 5 hardcoded capability modules (`corporate.company.read`, `corporate.oyi.read`, `corporate.private.read`, `corporate.partnerships.read`, `corporate.development.read`) that already answer some corporate questions with literal string constants — a real, live, ungoverned parallel knowledge source. **This corrects Slice 0's own conclusion that Development/Private knowledge is entirely MISSING** — narrow content exists, just not through any governed, versioned, or auditable mechanism, and not sourced from Office's `knowledge/` pack. This slice does not migrate or touch these modules (explicit scope discipline, §44's own "do not migrate all of them this slice") — flagged prominently for Slice 2.

**Fix applied**: `officeExport.ts`'s two route handlers now call `retrieveKnowledge()` (Backend's own new, real retrieval) before building the response, and both policy builders now populate `knowledge_references` from the real retrieved items — falling back to the old echo-input behavior only if retrieval finds nothing, so the existing contract is never broken.

## 4. Authority location

**Backend Core owns the knowledge retrieval contract.** Source material stays physically owned by Office (its `knowledge/` directory, unchanged in shape/location). This decision follows directly from Slice 0's own evidence: Oma/Osa already fully delegate reasoning to Backend Core (their local `LeadAgentRuntime` brain was deliberately retired, guarded by a real regression test) — the same convergence now applies to knowledge. Office was **not** made the permanent knowledge brain (it serves raw files only, no interpretation); no agent loads Markdown independently (only one bridge module, `officeKnowledgeBridge.ts`, ever fetches it).

## 5. Canonical knowledge item contract

`KnowledgeItem` (`knowledgeContracts.ts`) — 15 fields, each justified by a real distinction found in the actual 27-file corpus (not the brief's full suggested list applied blindly):

`id`, `canonicalKey`, `title`, `domain`, `authorityClass`, `audience`, `agentVisibility`, `content`, `sourceRepo`, `sourceFile`, `version`, `updatedAt`, `freshnessClass`, `claimBoundary`, `tags`.

Omitted from the brief's suggested list, deliberately: a separate "approval state" field (folded into `authorityClass`, since every item in this manifest is already a deliberate, reviewed classification — there is no draft/unapproved state in v1); a separate "commercial/technical classification" field (already expressed by `domain` + `authorityClass` together, a third field would duplicate it).

## 6. Authority classes

`APPROVED_INSTITUTIONAL > TECHNICAL_SOURCE > APPROVED_COMMERCIAL > PRODUCT_SOURCE > PROJECT_SOURCE > MARKETING_REFERENCE > UNVERIFIED_REFERENCE` (ranked, used for contradiction resolution — §12). Plus a non-retrievable `PROMPT_INSTRUCTION` classification for the one excluded file. Every class is populated by at least one real file in the current manifest except `PROJECT_SOURCE`, declared for future project-specific sources per §7's own "domains with zero content today" pattern.

## 7. Knowledge domains

`corporate | commercial | product | technology | website | development | private | partnerships` — the last three deliberately aligned to Backend's own existing, real `CorporateBusinessUnit` enum (discovered this slice, not previously connected to any knowledge concept), plus `commercial`/`product`/`website` because the Office pack's real content needs shapes `CorporateBusinessUnit` doesn't distinguish. `development`, `private`, `partnerships` have zero Office-pack items today — confirmed by full read of every file, not the outdated Slice 0 partial classification.

## 8/9. Source ownership — Office's 27-file pack, the first real source

| Source | Owner | Ingestion | Update responsibility |
|---|---|---|---|
| `knowledge/*.md` (Office) | Office (files) / Backend (classification+retrieval) | Backend fetches raw content via `officeKnowledgeBridge.ts` (`GET /api/lead-agents/admin/knowledge-pack`), cached 5 min TTL | Office edits files; Backend's `officeKnowledgeManifest.ts` must be updated by hand if a file's domain/authority truly changes (disclosed limitation, §22) |
| `OfficeCorporateCapabilityModules.ts`'s 5 hardcoded strings | Backend (code) | N/A — not part of this contract | Out of scope this slice, flagged for convergence |
| Backend `docs/*.md` | Backend | Not ingested (developer-facing only, confirmed by Slice 0) | N/A |
| Website/Oyi-page marketing copy | Each repo independently | Not ingested this slice | N/A, flagged for a future source class |

Identity/chunking/provenance/change-detection for the Office source (§9's own required questions): one `KnowledgeItem` per whole file (v1 granularity — simplest truthful representation given most files are 15-70 lines; `digital-twin-building-blueprint.md` at 137 lines is the one candidate for future section-level chunking, not split in v1). `id`/`canonicalKey` derive from the stable filename only; `version` is a content hash, recomputed every cache refresh — proven by the smoke's own versioning test (edit content → version changes, id/canonicalKey survive). Every item's `sourceFile` points back to `knowledge/<filename>.md`, auditable.

## 10. Per-file classification

All 27 content files + README read in full this slice (not name/README-triaged as Slice 0's own fork explicitly disclosed doing). Full table in `officeKnowledgeManifest.ts`'s own comments; summary:

- **APPROVED_INSTITUTIONAL** (4): `approved-system-description.md`, `ochiga-overview.md`, `company-explainer-patterns.md`, plus `system-overview-and-surfaces.md` (TECHNICAL_SOURCE, dated "as of April 12, 2026" — a real freshness marker).
- **TECHNICAL_SOURCE** (5): `system-overview-and-surfaces.md`, `business-model-and-current-maturity.md`, `edge-runtime-and-agent-stack.md`, `facility-control-system.md` (contains real NGN pricing — `requires_human_confirmation` claim boundary, `agentVisibility` excludes `oma` per the file's own literal instruction "Oma should not quote or negotiate from this file"), `consumer-app-and-ai-surfaces.md`.
- **PRODUCT_SOURCE** (5): `oyi-solution-map.md`, `modules-and-capabilities.md`, `product-boundaries-and-safe-claims.md`, `use-cases-and-needs.md`, `digital-twin-building-blueprint.md` (explicitly self-described as "proposed solution architecture… not a blanket claim of production-readiness" — `requires_qualification`).
- **APPROVED_COMMERCIAL** (11): `ideal-customers-and-fit.md`, `qualification-playbook.md` (Oma-only), `demo-and-discovery-playbook.md`, `osa-sales-narrative.md`, `commercial-guardrails.md`, `commercial-proposal-logic.md`, `commercial-signals-and-handoff.md`, `negotiation-intelligence.md`, `objection-and-reply-guide.md` — mixed `claimBoundary` per file (scripted-dialogue files like `negotiation-intelligence.md` are `safe_to_state`; internal-strategy files like `commercial-guardrails.md`/`ideal-customers-and-fit.md` are `do_not_state_verbatim`).
- **MARKETING_REFERENCE** (3): `pitch-deck-positioning.md`, `website-messaging.md`, `websites-positioning-and-deployments.md`.
- **UNVERIFIED_REFERENCE** (1): `demo-narrative.md`.
- **Excluded** (2): `README.md` (REFERENCE_DOCUMENT, the pack's own meta-doc), `agent-voice-and-style.md` (PROMPT_INSTRUCTION, never retrievable as fact).

**No file was assumed canonical merely by being present** — each classification above was decided against the file's own actual content and any self-disclosed caveats.

## 11. Retrieval contract

`retrieveKnowledge(request: RetrieveKnowledgeRequest): Promise<RetrieveKnowledgeResult>` (`knowledgeRetrieval.ts`) — the ONE Core knowledge retrieval interface. Preserves identity/authority/provenance/source/relevance/version/visibility on every returned item (never an anonymous text blob, §11's own explicit requirement).

## 12. Agent-aware, not agent-owned

No `omaKnowledgeService`/`osaKnowledgeService` exists. Facility, Consumer, Oma, Osa, Executive would all call the same `retrieveKnowledge()` with a different `actor` — proven for Oma/Osa this slice (§26 below); Facility/Consumer compatibility verified but not wired (§38).

## 13/14. Authorization, public/internal separation

Two independent gates, both enforced before ranking (never after): `audienceAllowed` (PUBLIC / INTERNAL_COMMERCIAL / INTERNAL_ONLY ceiling — a caller's `audienceScope` never widens) and `agentAllowed` (`agentVisibility` array membership). Proven by the smoke: a PUBLIC-audienceScope Osa (the real wiring's own posture on `/conversation/corporate`) is blocked from `facility-control-system.md` even though `agentVisibility` includes `osa` — **agentVisibility alone never overrides the audience ceiling**. The staff `/conversation/internal` route grants `INTERNAL_COMMERCIAL` audienceScope, proven able to retrieve the same item.

## 15. Safe claims

`claimBoundary` (`safe_to_state | requires_qualification | requires_human_confirmation | do_not_state_verbatim`) is carried on every item, derived directly from `product-boundaries-and-safe-claims.md`'s own real distinctions — not a second policy engine, a single flat field read (never re-decided) by callers.

## 16. Product maturity handling

`business-model-and-current-maturity.md` (TECHNICAL_SOURCE) is the one file explicitly distinguishing "implemented now" from "strongly positioned but not fully proven" — retrieval surfaces it with its real authority class; it is never allowed to claim more than its own text does, and nothing in this slice invents a capability from documentation alone.

## 17/18. Retrieval strategy, ranking

Structured metadata filtering (audience/agentVisibility/domain, domain as a **hard filter** when the caller specifies it — corrected during this slice's own testing, see §19 below) + lightweight lexical scoring (term overlap). No embeddings/vector infrastructure — unjustified by the real corpus size (1,139 lines / 26 items, confirmed by direct read). Ranking weights: lexical match 45%, domain match 25%, authority 20%, freshness 10% — authority and freshness exist specifically so a highly-lexically-relevant marketing sentence cannot outrank contradictory approved technical truth (proven by the smoke's authority-ordering test).

## 19. Contradiction handling

Resolved by the authority rank order (§6), never blended. Ties broken by authority rank in the sort comparator, never left to incidental array order. No LLM improvisation exists anywhere in this module — `scoreItem`/`boundResults` are pure, deterministic functions.

## 20. Citations/provenance

Every `RankedKnowledgeItem` carries `sourceFile` + `rankReason` internally. The public-facing response strips to `{id,title,source}` (the pre-existing, narrower contract type already distinct from the internal `{id,title,excerpt,source}` shape) — proven by the smoke to never leak an excerpt to the public response.

## 21/22. Versioning, freshness

Identity (`id`/`canonicalKey`) survives edits; `version` (content hash) changes — proven by the smoke's dedicated versioning test. `freshnessClass` (`evergreen`/`volatile`) is per-item, not a universal TTL — company identity files are evergreen; anything describing current maturity, pricing, or website positioning is volatile.

## 23–25. Memory / live-state / CRM boundaries

Not read, not written, not touched anywhere in this slice's code. `retrieveKnowledge()` has no parameter and no code path that reads `lead_memories`, Wave 5/6 device/camera state, or CRM Opportunity/stage data.

## 26–29. First live integration

Wired into `POST /conversation/corporate` and `POST /conversation/internal` (`officeExport.ts`) — the exact gap Slice 0 identified (Oma/Osa already on Backend Core, `knowledge_context` empty). `knowledgeDomainsForBusinessUnit()` maps the request's own already-structured `business_unit` field to retrieval domains — **no second LLM call to formulate search**, per §28's explicit instruction. Retrieved items are mapped into the response's `knowledge_references` field only; the underlying `answer`/`canonical.reply` text generation itself (the 5 hardcoded capability modules, or whatever produces the rest of the reply) is **not** modified this slice — a deliberate, disclosed scope limit, not an oversight.

## 30. Context/token budget

Bounded by both item count (`limit`, capped at 8) and a 6,000-character budget, whichever binds first — proven by the smoke: a query never returns the full 26-item corpus.

## 31/32. Failure and unknown-answer behavior

Office unreachable → `retrieveKnowledge()` returns an empty result, never fabricated content (proven by the smoke, with the failure logged via `oyi_knowledge_source_unavailable`). A domain with zero real content (`development`, `private`, `partnerships`) honestly returns zero items — proven directly by the §33/35 tests below, not simulated.

## 33–37. Representative query proofs (all via the functional smoke, real manifest + mocked Office content)

- **Development** ("landowner seeking a JV"): zero Office-pack items returned for the `development` domain — honest, matches the confirmed-MISSING finding (with the caveat re: `OfficeCorporateCapabilityModules.ts`'s separate hardcoded `corporate.development.read`, §3).
- **Private** ("What is Ochiga Private?"): zero items, same honesty proof.
- **Technology** ("What is Oyi Edge?"): real technology-domain content retrieved; `edge-runtime-and-agent-stack.md` correctly withheld from any PUBLIC-audienceScope caller (Oma or Osa on the real public route), correctly available to the staff internal route.
- **Cross-domain** ("200 apartments, smart from construction"): both `development` and `technology` domains reported in `domainsSearched`, never silently collapsed into one.
- **Role consistency**: Oma and Osa querying the same corporate fact receive byte-identical `content`/`version` for any item both may see — proven directly, not asserted.

## 38. Facility/Consumer compatibility

Not migrated this slice. Verified non-conflicting: `retrieveKnowledge()` is a new, additive module with no shared state, no modified shared type outside the two corporate policy files' own new optional parameter (defaulted, backward-compatible). Future adoption path: Facility/Consumer's own conversation runtime (`oyiUnifiedIntelligenceService.ts`, per Slice 0) would call `retrieveKnowledge()` with `agentRole: "facility"|"consumer"` and its own audience scope — no new service needed, per §12's own architecture.

## 39. Observability

`operationalMetrics.increment("oyi_knowledge_retrieval_total", {outcome, agent_role, domain, result_count})` — all low-cardinality. No raw query text, no customer/session identifiers in any metric label.

## 40. Performance

Exactly one Office HTTP call per cache refresh (5-minute TTL, 15-second TTL on failure to avoid wedging a transient outage), never one per query — mirrors `officeOpportunityBridge.ts`'s own established "no N+1" discipline. No per-request file/repository scan.

## 41. Persistence decision

**No database table.** Corpus confirmed small (1,139 lines / 26 items) by direct full read this slice — file/build-time-equivalent in-memory indexing (runtime-fetched + cached, not build-time-copied, per §42's own preference for a live API over brittle filesystem coupling) is sufficient. **No migration gate reached; none proposed.**

## 42. Source synchronization

Runtime API pull (`GET /api/lead-agents/admin/knowledge-pack`, new Office route, gated by the same `x-office-api-key` shared-secret pattern as every other Backend→Office bridge call) — chosen over build-time copying (would go stale between deploys) or a shared npm package (unjustified overhead for 27 small files, and would still need a sync step). Matches the codebase's own established, evidence-backed bridge pattern exactly (`officeOpportunityBridge.ts`).

## 43. Anti-fragmentation guard

The functional smoke itself is the guard: it proves (a) `buildCorporatePublicResponse`/`buildOfficeInternalResponse` only ever receive knowledge via the shared `retrieveKnowledge()` call, never a locally-loaded file; (b) both Oma and Osa query the identical underlying corpus (role-consistency test, §37); (c) no `omaKnowledgeService`-shaped module exists anywhere in this diff. Recommended for a future Slice: a dedicated static-analysis guard (grepping for any new `fs.readFile`/`require("./knowledge`-style import outside `officeKnowledgeBridge.ts`) — not built this slice, since none exists to guard against yet.

## 44. Same-class search (system-wide)

| Match | Class |
|---|---|
| `officeKnowledgeBridge.ts`/`knowledgeRetrieval.ts` (this slice) | **CANONICAL_CANDIDATE** |
| `OfficeCorporateCapabilityModules.ts`'s 5 hardcoded strings | **PROMPT_EMBEDDED / AGENT_LOCAL** — real, live, not migrated |
| Office's `prompt-packs/marketing-agent`, `prompt-packs/sales-agent` (per Slice 0) | **LEGACY/DEAD** — zero production callers, unchanged |
| Website/Oyi-page marketing copy (per Slice 0) | **MARKETING_ONLY** — not ingested |
| Backend `docs/*.md` | **DOMAIN_REFERENCE** — developer-facing, not ingested |

No migration of any of these performed this slice, per explicit instruction.

## 45. Security

Proven by the functional smoke: PUBLIC callers cannot retrieve INTERNAL_COMMERCIAL items; agent-role gating is enforced independently of audience; no file-path parameter exists anywhere in `RetrieveKnowledgeRequest` (no path traversal surface — the only "path" in the system is the hardcoded `knowledge/` directory read server-side by Office's own new route, never caller-influenced); the Office route requires the exact same shared-secret header every other bridge route requires, returns `401` on mismatch; no request field can grant an item's classification (manifest classifications are hardcoded in Backend's own source, never derived from request content).

## 46. Wave 5-8 freeze

Zero files under Wave 5-8's own authority modules were touched. Re-ran `smoke:wave8-slice5-learning-parameter-consumer` (21/21) and `smoke:wave8-slice6-remaining-domain-outcome-evaluators` (31/31) — both clean, confirming no regression.

---

*Docs, contracts, manifest, bridge, retrieval service, and the two policy-file/route wiring changes are described above; see the accompanying commit for the exact diff.*
