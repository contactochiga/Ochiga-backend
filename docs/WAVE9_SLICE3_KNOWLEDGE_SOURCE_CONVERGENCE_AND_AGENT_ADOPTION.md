# Wave 9 — Slice 3: Knowledge Source Convergence & Agent Adoption Audit

Status: LOCAL ONLY. Not pushed, not deployed. Backend pre-slice HEAD: `9646737`. Office HEAD: `e85b17b` (unchanged — no Office code required this slice).

## 1. Mission recap

Slice 2 closed the named institutional-knowledge convergence target (`OfficeCorporateCapabilityModules.ts`'s 5 hardcoded answers) but left four disclosed gaps: (A) a latent second hardcoded fact source in `corporatePublicConversationPolicy.ts`, (B) a Partnerships terminology drift, (C) no static Development identity item, (D) no full pack-wide duplication sweep or cross-agent adoption plan. Slice 3's job was to close A-C with real, narrow code changes, and audit (D) plus every other agent surface (Facility, Consumer, Executive, public widget, Twin) for what they currently know and how they should eventually adopt the canonical contract — without migrating any of it yet.

## 2. corporatePublicConversationPolicy.ts — full audit and resolution

`answerFor()` has 7 branches after the top canonical-answer check. Full inventory (confirmed by direct re-read, not from memory):

1. "what is Ochiga" — **factual identity claim**, duplicate of `backend:corporate-company`. **Converged.**
2. "what is Oyi" — **factual identity claim**, duplicate of `backend:corporate-oyi` (and previously materially different wording). **Converged.**
3. `business_unit === "development"` — conversational routing acknowledgment ("I can capture the site context..."), not a factual claim. **Left untouched.**
4. `business_unit === "private"` — routing acknowledgment, not `backend:corporate-private`'s actual membership-stage content. **Left untouched.**
5. `business_unit === "partnerships"` — routing acknowledgment. **Left untouched.**
6. `signal === "proposal"/"qualification"` — generic qualification-path text, not a per-division fact. **Left untouched.**
7. Final default — generic capability-scope sentence. **Left untouched.**

Only branches 1-2 were a genuine "second independent factual authority" problem; branches 3-7 are a different kind of content entirely, and converging them would have been a category error (this is why the task's own instruction to "not remove unrelated policy behavior" was honored literally). Call graph confirmed: `answerFor()` has exactly one call site (`buildCorporatePublicResponse`), which itself has exactly one caller (`officeExport.ts`'s `/conversation/corporate` route, inside an already-`async` handler that already awaits `retrieveKnowledge()`). No other file references `answerFor()` or its literal strings.

**Resolution implemented**: branches 1-2 now call `getKnowledgeItemByCanonicalKey("backend:corporate-company"/"backend:corporate-oyi", actor)`, falling back to the exact original literal on any failure — the identical pattern Slice 2 proved safe in `OfficeCorporateCapabilityModules.ts`. This required `answerFor()` and `buildCorporatePublicResponse()` to become `async`; the single production call site and both smoke-test call sites were updated to `await` them (confirmed via `npm run typecheck` — clean, zero other callers). After this slice, there are no longer two independent factual authorities for Ochiga or Oyi identity anywhere in the codebase.

## 3. Partnerships terminology — resolved

Direct audit of `app/partnerships/page.tsx` (rebuilt 2026-08-11, "feat: rebuild partnerships ecosystem experience") found **6** distinct, real partner-type cards: Landowners & Joint Ventures, Capital Partners, Buyers & Offtake, **Delivery Professionals** (AEC), **Technology & Oyi Integrators** (IoT/automation/OEM), **Strategic Partners** (institutional/financial/hospitality) — each with its own description and intake path. `lib/company.ts`'s nav config still uses a coarser 4-category grouping (matching the canonical item's pre-Slice-3 wording, "Professional/Strategic Partners"), which is itself still real and current, just under-specified relative to the page rebuild.

This was a genuine **source-authority resolution**, not a "pick the newer wording" call: the nav-level 4-category grouping is kept (appropriate for a short identity statement, matches the site's own navigation structure), but the 4th category's label is corrected from the single stale "Professional/Strategic Partners" to name all 3 real sub-paths — "Delivery Professionals, Technology/Oyi Integrators & Strategic Partners." Neither the website nor the canonical item's other 3 categories were rewritten. Verified by the new Slice 3 smoke (check 11).

## 4. Development institutional knowledge — added

Direct read of `app/development/page.tsx` found genuine durable institutional identity content, distinct from that same page's volatile `CURRENT_DEVELOPMENTS` array (Havana Residences, Green Gardens, etc.): a mission statement ("We create places designed for how people will live next... designed not only to be delivered, but to operate and evolve") and an 8-stage development journey (Land, Strategy, Design, Capital, Delivery, Sales, Technology, Operations) rendered via `DevelopmentJourney`. This answers "what IS Ochiga Development" — a different, durable question from "what projects currently exist," which `corporate.development.read`'s live Sanity fetch correctly continues to own, untouched.

Added as a genuinely **new** canonical item, `backend:corporate-development` (domain `development`, `APPROVED_INSTITUTIONAL`, `PUBLIC`, `safe_to_state`) — not a conversion of existing hardcoded text, since none existed for this specific question. It is automatically reachable in production today with zero new capability wiring: `officeExport.ts`'s pre-existing `knowledgeDomainsForBusinessUnit("development")` already maps to `domains: ["development"]`, and `retrieveKnowledge()`'s free-text path (unmodified since Slice 1) now returns this item for that domain. Verified by the new Slice 3 smoke (checks 9-10) and by Slice 1's own re-verified query proof (§33, now correctly returning 1 item instead of 0).

## 5-6. Full 27-file Office pack duplication/fact-level sweep

**Headline finding**: nearly the entire Office knowledge pack describes a materially **different corporate model** than the now-canonical one. The canonical model (from `backendInstitutionalKnowledge.ts` and the live website) is: Ochiga is a real-estate developer running three engines — Development, Oyi (its own building-operating technology), Private (investment network) — with Partnerships as a cross-cutting relationship layer. The Office pack instead frames Ochiga as a **standalone B2B infrastructure-SaaS company** selling "Oyi Infrastructure Operating System" with tiered packages (Core/Operations/Infrastructure/Command Center) directly to estates/buildings as customers. It never mentions Ochiga Private, Ochiga Development, or the three-engines framing at all.

Full per-file classification (28 files, including the 2 manifest-excluded ones):

| File | Classification | Duplicates/Conflicts |
|---|---|---|
| README.md | META (excluded) | — |
| agent-voice-and-style.md | PROMPT/STYLE_ONLY (excluded) | — |
| approved-system-description.md | CONTRADICTORY | Conflicts `backendInstitutionalKnowledge.ts` company/oyi items |
| business-model-and-current-maturity.md | TECHNICAL_REFERENCE | Rests on the same non-canonical B2B-SaaS model |
| commercial-guardrails.md | POLICY | Overlaps `commercial-signals-and-handoff.md` (rules vs. signals) |
| commercial-proposal-logic.md | NEAR_DUPLICATE | `oyi-solution-map.md`, `osa-sales-narrative.md` |
| commercial-signals-and-handoff.md | NEAR_DUPLICATE | `ideal-customers-and-fit.md`, `qualification-playbook.md` |
| company-explainer-patterns.md | NEAR_DUPLICATE | `approved-system-description.md`, `objection-and-reply-guide.md` |
| consumer-app-and-ai-surfaces.md | UNIQUE_CANONICAL_CONTENT | — |
| demo-and-discovery-playbook.md | COMPLEMENTARY | `demo-narrative.md` |
| demo-narrative.md | COMPLEMENTARY | `demo-and-discovery-playbook.md` |
| digital-twin-building-blueprint.md | UNIQUE_CANONICAL_CONTENT | — |
| edge-runtime-and-agent-stack.md | UNIQUE_CANONICAL_CONTENT | — |
| facility-control-system.md | UNIQUE_CANONICAL_CONTENT | Only file with live pricing; Oma-excluded already |
| ideal-customers-and-fit.md | NEAR_DUPLICATE | `commercial-signals-and-handoff.md`, `use-cases-and-needs.md` |
| modules-and-capabilities.md | NEAR_DUPLICATE | `oyi-solution-map.md`, `use-cases-and-needs.md` |
| negotiation-intelligence.md | UNIQUE_CANONICAL_CONTENT | — |
| objection-and-reply-guide.md | DUPLICATE (filename mismatch — not actually objection-handling) | `company-explainer-patterns.md` |
| ochiga-overview.md | CONTRADICTORY + NEAR_DUPLICATE | `oyi-solution-map.md`; conflicts canonical model |
| osa-sales-narrative.md | NEAR_DUPLICATE | `oyi-solution-map.md`, `commercial-proposal-logic.md` |
| oyi-solution-map.md | UNIQUE_CANONICAL_CONTENT (source of 3 dupes) + CONTRADICTORY | Duplicated by 3 files; conflicts canonical model |
| pitch-deck-positioning.md | MARKETING_REFERENCE | — |
| product-boundaries-and-safe-claims.md | POLICY + NEAR_DUPLICATE | `approved-system-description.md` |
| qualification-playbook.md | COMPLEMENTARY | `commercial-signals-and-handoff.md` (partial) |
| system-overview-and-surfaces.md | STALE + NEAR_DUPLICATE | Self-dated ~5 months stale; `ochiga-overview.md` |
| use-cases-and-needs.md | NEAR_DUPLICATE + COMPLEMENTARY | `modules-and-capabilities.md` |
| website-messaging.md | STALE + NEAR_DUPLICATE | `websites-positioning-and-deployments.md` |
| websites-positioning-and-deployments.md | STALE + CONTRADICTORY | Lists a site nav ("Solutions, Architecture, Governance...") that **no longer exists** — confirmed against `lib/company.ts`'s real current nav |

**Fact-level duplication (§6)**: "what Oyi is" is expressed independently in at least 4 Office-pack files (`oyi-solution-map.md`, `ochiga-overview.md`, `osa-sales-narrative.md`, `commercial-proposal-logic.md`) plus the now-canonical `backend:corporate-oyi` — 5 independent expressions of one fact, none of which fully agree with each other or with canonical. This is the single largest remaining duplication surface in the system and is the natural next convergence target (see §14, Slice 4 proposal).

## 7. Authority resolution map

| Fact | Canonical owner | Reference source | Fallback | Retirement candidate |
|---|---|---|---|---|
| What is Ochiga | `backend:corporate-company` | — | Original literal (defense-in-depth) | — |
| What is Oyi | `backend:corporate-oyi` | — | Original literal | Office pack's 4 conflicting Oyi descriptions (§6) |
| What is Ochiga Development | `backend:corporate-development` | Office's `business-model-and-current-maturity.md` (technical detail only) | — | — |
| What is Ochiga Private | `backend:corporate-private` | — | — | — |
| Partnerships tracks | `backend:corporate-partnerships` | `app/partnerships/page.tsx` (richer 6-card detail) | — | — |
| Oyi product positioning ("Infrastructure OS", packages) | **Unresolved** — no single canonical owner yet | `oyi-solution-map.md` et al. | — | `websites-positioning-and-deployments.md` (stale nav), `website-messaging.md` (stale) |
| Facility pricing | `facility-control-system.md` (Office-internal only) | — | — | — |

## 8. Facility agent knowledge audit

Direct audit of `src/oyi-core/` device/camera/automation/maintenance/access/visitor domains found: the dominant category is **LIVE STATE** (evidence-templating engines — `deviceConversationAnswers.ts`, `cameraCanonicalSignal.ts`, the `*Evidence.ts` files — with empty-state error templates, not knowledge). **CAPABILITY DESCRIPTION** exists as one hardcoded sentence (`surfaceConversationPolicy.ts`: "I can answer authorised building operations questions...") plus structural module-registration metadata. **POLICY** exists as privacy-class gating (`CapabilityService.ts`), signal-routing rules (`intelligencePolicyResolver.ts`), and domain reasoning rules (`domainReasoningPolicies.ts`'s `ownerRule`/`severityRule`/`recoveryRule`). **ROLE/PROMPT**: no discrete prompt module exists (Facility is capability-routed, not prompt-assembled).

**Domain-knowledge candidates**: none found with confidence. The `ownerRule` strings in `domainReasoningPolicies.ts` are the closest near-miss (durable statements about how ownership/routing works) but function as internal reasoning-policy fields, never surfaced verbatim to a user — POLICY today, a plausible future migration candidate only if Facility needs to explain "why does this route to me" conversationally.

## 9. Consumer agent knowledge audit

Same method, same file set (devices/camera/maintenance/security/visitors/utilities/automations/roomHome — largely shared with Facility, differentiated by `supportedSurfaces`). Same conclusion: **LIVE STATE** dominates (`roomHomeCapabilities.ts` builds room/home summaries from live facts). **CAPABILITY DESCRIPTION**: one hardcoded sentence in `surfaceConversationPolicy.ts` plus Consumer-only module registrations (wallet, utilities, scenes, automations). **POLICY**: same shared privacy/routing/reasoning layer, plus a Consumer-specific `financial_sensitive` privacy class. **ROLE/PROMPT**: none found; no product-explainer prose module exists for end users.

**Honest conclusion for both Facility and Consumer**: zero genuine static domain-knowledge content exists today in the canonical-contract sense. Everything decomposes into live state, capability description, or policy. This differs structurally from Oma/Osa's prior state (which had a large static-prose corpus — the Office 27-file pack — to converge). Any future Facility/Consumer canonical-knowledge adoption means **authoring new** explanatory content (e.g., "what does 'degraded' health mean," "how does a scene differ from an automation"), not migrating existing hardcoded text, since none currently exists in that shape.

## 10. Executive/internal knowledge audit

`knowledgeContracts.ts` already defines `executive` as a `KnowledgeAgentRole`, and all 5 converged/new Backend-native items (Slice 2 + Slice 3) already include `executive` in `agentVisibility` — Executive already shares the same canonical institutional facts as Oma/Osa/office_internal, no gap there. Office's manifest extends further internal-only sharing to `["osa","office_internal","executive"]` for several docs (business model/maturity, edge/agent-stack, pitch-deck positioning) — Executive has no isolated documentation silo.

Genuinely internal-only: `runtime/executive.ts`'s `buildExecutiveBriefing()` (271 lines) is 100% computed from live operational signals/insights/recommendations/execution-ledger records — no hardcoded facts, nothing to converge, correctly excluded as live state by the same reasoning already applied to `corporate.development.read`. Governance: `intelligencePolicyResolver.ts` explicitly denies Executive aggregation/briefing channels for `resident_device_private`/`smart_access_private`/`home_private` privacy classes — Executive gets aggregated operational visibility, walled off from private resident data. No `ExecutiveCapabilityModules.ts`-style hardcoded-duplicate-authority bug exists (searched, zero matches) — Executive never had a Slice-2-class problem.

## 11. Oma/Osa post-convergence audit

Both now consume canonical institutional knowledge (5 Backend-native items + Office's classified pack, via `retrieveKnowledge()`) plus role-specific commercial knowledge (office_internal-gated Office-pack items), without owning independent factual corporate truth for company/oyi/development/private/partnerships identity — confirmed by this slice's own retirement of the last remaining independent authority (`corporatePublicConversationPolicy.ts`'s Ochiga/Oyi branches, §2). Remaining local facts: the 5 routing/process branches (§2, items 3-7) — correctly not facts, and the still-unresolved Office-pack "what is Oyi" product-positioning cluster (§6/§7) — flagged for Slice 4, not owned by Oma/Osa specifically (it's a pack-wide contradiction, not an agent-local hardcode).

## 12. Public-agent (website widget) adoption status

`getoyi.com` (repo `oyi-page`) embeds a chat widget (`data-oma-widget`, served from `ochiga-office`'s `public/widget/oma-widget.js`) that posts to Office's `/api/lead-agents/public/chat`, which calls `callOyiCoreCorporateConversation()` — delegating the entire conversation to Backend's own Oyi Core, the same canonical authority Oma/Osa use. Office only attaches a permission-gated CRM/leads snapshot on top; private/operational requests are explicitly blocked before reaching Core. **This is delegation, not duplication** — unlike the pre-Slice-2 `OfficeCorporateCapabilityModules.ts` problem, the public widget carries no separate hardcoded factual answers of its own. `Ochiga-website` (the corporate site, separate from `oyi-page`) has no chat widget/assistant at all. **Adoption status: COMPLETE** — no migration needed.

## 13. Twin/Spatial knowledge boundary (not connected this slice)

`Oyi-Twin-Engine`'s own README already states the intended split; Backend's `/spaces/twin`,`/spaces/model` stub API (`spacesTwin.ts`) is `configured: false`, not yet called. Boundary for a future slice:
1. **Spatial/project facts** (static layout, canonical refs matching `homes.canonical_ref`) — future canonical-knowledge candidate, same class of fact Backend's stub twin API already claims ownership of.
2. **Live model/runtime state** (`twinRuntime.ts`, Luna's resolvers) — must stay live state permanently, mirrors real device state.
3. **Product documentation** — found only outside the engine repo, on `oyi-page`'s public marketing pages; pure frontend/marketing concern, no agent-knowledge dimension.
4. **Agent knowledge** (`OyiPanel.tsx`'s in-twin conversational surface) — entirely a natural-language rendering of category 2's live state per the engine's own code comments; inherits category 2's boundary, not an independent knowledge base.

## 14. Technical knowledge source map (abbreviated — full detail in the fork transcript, synthesized here)

| Area | Technical owner | Institutional owner | Live-state authority |
|---|---|---|---|
| Facility OS | `oyiUnifiedIntelligenceService.ts` | `facility-control-system.md` (disconnected from runtime per Wave 9 §6) | Wave 5-8 authority modules |
| Consumer OS | Same engine, `Oyi-os-frontend` | `consumer-app-and-ai-surfaces.md` | Backend proxy |
| Edge | `oyi-edge-agent` | `edge-runtime-and-agent-stack.md` | none — no server heartbeat expiry (Wave 6 §13) |
| Camera | `src/modules/cameras/*` | none dedicated | none — `canonicalCameraHealth.ts` is projection only (Wave 6 §7) |
| Device/IoT | `src/device/adapters/*` | `modules-and-capabilities.md` (generic) | `deviceRuntimeStateService.ts` |
| Access | `smartAccessController.ts` | generic mentions only | `smartAccessCapabilityService.ts` (Tuya-backed only) |
| Meters | `providerRegistry.ts` (taxonomy only) | one mention in the twin blueprint file | none |
| Automation | `facilityAutomationService.ts` | none dedicated | `facilityAutomationService.ts` |
| Digital Twin | `Oyi-Twin-Engine` + `twinProviderService.ts` | `digital-twin-building-blueprint.md` (self-labeled "not production-ready") | none — zero live Backend connection |
| Spatial | `spatialFacilityContextService.ts` | same twin blueprint file | disagrees with `camera_infrastructure` in places (Wave 6 §17) |
| AI/Intelligence | `oyiUnifiedIntelligenceService.ts` (deterministic) + 3 narrow real-LLM modules | `ochiga-overview.md` | `executive.ts` (read-aggregation only) |

## 15. Product maturity map

LIVE: Facility OS, Automation (narrow), Edge (narrow — 2-command whitelist). PARTIAL: Consumer OS, Camera (not yet a unified authority per Wave 6), Device/IoT (only tuya/onvif/ssdp/oyi_edge active; mqtt/matter/homekit/etc. are `adapter_required`), Access (Tuya lock only), Digital Twin (ships, renders, but zero live Backend connection), Spatial, AI/Intelligence (deterministic core + 3 narrow LLM call sites). PLANNED: Meters (every capable provider except generic pass-through is `adapter_required`). **ABSENT, correctly never claimed anywhere in canonical or Office-pack knowledge**: voice/telephony, outbound/inbound calling — zero Twilio/telephony reference across all 8 audited repos, re-confirmed this slice. Calendar integration is PARTIAL — deep-link generation only, no OAuth/API write.

## 16-17. Unsupported capability-claim sweep + voice claim

Searched `OfficeCorporateCapabilityModules.ts`, `backendInstitutionalKnowledge.ts`, `corporatePublicConversationPolicy.ts`, and all 27 Office pack files for claim-verbs ("can control," "can call," "supports," "predicts," "learns," etc.). **None found** as overclaims: Office's own `product-boundaries-and-safe-claims.md` and `modules-and-capabilities.md` explicitly instruct agents not to claim exact integrations/hardware/timelines; `digital-twin-building-blueprint.md` self-labels as "proposed... not a blanket production-ready claim"; every "call"/"calling" mention in the pack refers to human sales calls, never AI telephony; `ochiga-overview.md`'s "predictions" claim is supported by real shipped code (`predictionProviders.ts`). The one latent risk on record remains §2's now-resolved `corporatePublicConversationPolicy.ts` fallback — not a live overclaim.

## 18. Reusable knowledge adoption contract

The pattern any future agent role adopts is already fully specified by Slice 1/2/3's own implementation, requiring no new design work: `agent role → retrieveKnowledge({actor: {agentRole, audienceScope}, query, domains}) or getKnowledgeItemByCanonicalKey(key, actor) → audienceAllowed()+agentAllowed() gate runs before ranking → bounded, ranked KnowledgeItem[] → reasoning layer`. No agent ever loads raw Markdown itself — Facility/Consumer/Executive would each add their `KnowledgeAgentRole` value to a relevant item's `agentVisibility` array and call the exact same two functions Oma/Osa/office_internal already use. Zero new infrastructure required for adoption; only new *content* (per §8/§9's finding that Facility/Consumer have none to migrate yet) and *wiring* (a `retrieveKnowledge()` call in their own conversation-building path, mirroring `officeExport.ts`'s existing pattern) would be needed.

## 19-21. Facility / Consumer / Executive adoption plans (classification only, not implemented)

- **Facility**: canonical candidates are currently zero (§8); when authored, likely items are non-live conceptual explainers ("what does a health status mean," "device vs. system distinction"). Everything else (live state, capability description, policy) stays exactly where it is. No retrieval call needed until real content exists to retrieve.
- **Consumer**: same shape as Facility (§9) — zero candidates today; future candidates would be user-facing product concepts ("what is a scene," "what is Oyi to a resident"), which do NOT yet exist as canonical items and were not fabricated this slice.
- **Executive**: already effectively adopted (§10) — the 5 Backend-native items already include `executive` in `agentVisibility`. No further action needed; Executive's only non-adopted content is genuinely internal live-state briefing data, which must never become static knowledge.

## 22-23. Oma/Osa and public-agent adoption status

**Oma/Osa: COMPLETE for identity facts** (§11) — the last independent authority was retired this slice. **PARTIAL for product-positioning facts** — the Office pack's own internal 5-way "what is Oyi" duplication (§6/§7) is not yet resolved into one canonical owner; this is a pack-content problem, not an Oma/Osa-local hardcode, and is the top Slice 4 candidate. **Public widget: COMPLETE** (§12) — pure delegation, nothing to migrate.

## 24. Cross-agent fact consistency

Directly testable today (smoke-verified): "What is Ochiga," "What is Oyi," "What is Ochiga Development," "What is Ochiga Private" — Oma and Osa answer identically (Slice 2 smoke check 2; Slice 3 smoke checks 1-2). "Does Oyi support cameras" / "Can Oyi call customers" — no canonical or Office-pack source claims phone capability (§17); camera support is real but the pack itself has no dedicated authoritative camera-knowledge file (§14 gap). "What is Facility OS" / "What is Consumer OS" / "What is Edge" / "What is Digital Twin" — these remain **Office-pack answers only** (no Backend-native canonical items exist for them yet), and the pack's own internal contradictions (§5-6) mean a caller could get inconsistent framing across which pack file is ranked highest for a given query — a real, disclosed gap for Slice 4, not fabricated as resolved here.

## 25. Knowledge-vs-capability proof

Structural, not new this slice: every `KnowledgeItem` (Office-pack or Backend-native) carries no execution handle — retrieval returns text and metadata only (`knowledgeContracts.ts`'s `KnowledgeItem` type has no action/permission field). A knowledge item stating "Facility can control devices" (if one existed) would never itself grant Oma device-control authority — that authority is a completely separate code path (`smartAccessCapabilityService.ts`, permission-gated capability modules), proven unreachable from the knowledge layer by construction (Slice 2 smoke check 7, re-verified this slice: converged modules carry `risk_class: "read"`, `permission_requirements: []`).

## 26. Knowledge-vs-live-state proof

Reconfirmed, not just asserted: every domain audited this slice (§8/§9/§14) shows knowledge (durable explanatory text) and live state (current operational fact) served by disjoint code paths — `deviceConversationAnswers.ts` et al. templating live evidence never touches `knowledgeRetrieval.ts`, and `retrieveKnowledge()` never queries live device/camera tables. No knowledge source in this codebase answers live operational state, and none was made to this slice.

## 27. Knowledge-vs-memory proof

No customer-specific history, conversation history, or lead/opportunity data entered institutional knowledge this slice — the two new/modified knowledge items (`backend:corporate-development`, `backend:corporate-partnerships`) are both static, non-customer-specific institutional facts, unchanged in kind from Slice 2's four.

## 28. Retirement ledger

| Source | Disposition | Reasoning |
|---|---|---|
| `backendInstitutionalKnowledge.ts` (5 items) | **KEEP_CANONICAL** | Highest-authority, single-owner facts |
| Office pack: `digital-twin-building-blueprint.md`, `edge-runtime-and-agent-stack.md`, `consumer-app-and-ai-surfaces.md`, `negotiation-intelligence.md`, `facility-control-system.md` | **KEEP_CANONICAL** (Office-owned, already correctly authoritative) | Genuinely unique content, no conflict found |
| `oyi-solution-map.md` | **KEEP_REFERENCE**, flagged CONTRADICTORY | Source of 3 internal dupes; needs Slice 4 resolution against canonical model, not deletion (real detail exists here) |
| `commercial-proposal-logic.md`, `ochiga-overview.md`, `osa-sales-narrative.md` | **MIGRATE_TO_CANONICAL** candidates (consolidate into one Oyi-product-positioning owner) | 4-way duplicate of "what is Oyi" product framing |
| `objection-and-reply-guide.md` | **MIGRATE_TO_CANONICAL** (merge into `company-explainer-patterns.md`) or **LEGACY** rename | Filename doesn't match content; near-duplicate |
| `system-overview-and-surfaces.md`, `website-messaging.md`, `websites-positioning-and-deployments.md` | **LEGACY** | Self-dated/confirmed stale; `websites-positioning-and-deployments.md` cites a nav structure that no longer exists |
| `corporatePublicConversationPolicy.ts` branches 1-2 (old literals) | **REMOVE_AFTER_MIGRATION** — kept only as in-code fallback constants | Migration completed this slice; literals retained for defense-in-depth, not as an active authority |
| `corporatePublicConversationPolicy.ts` branches 3-7 | **KEEP_REFERENCE** (in code, not knowledge) | Correctly not facts; audited and confirmed safe to leave as-is |
| All other Office pack files not listed above | **KEEP_REFERENCE** | Real complementary/technical content, correctly classified, no action needed |

Wave 10 (or a future slice) can consume this ledger directly; nothing was mass-deleted this slice.

## 29-32. Security, performance, persistence, Wave 5-8 freeze

**Security**: re-ran Slice 1's full public/internal audience-gate test suite (unchanged, 5/5 green within the 19-check Slice 1 smoke) plus Slice 2/3's own authorization checks (Backend-native items gated identically to Office-pack items). No Facility/Consumer adoption *implementation* occurred this slice, so no new leakage surface was created — the adoption plans (§19-20) are classification only. **Performance**: `knowledgeRetrieval.ts`'s cache logic (5min/15s TTL) untouched; the new item is a pure in-memory constant, no new network call. **Persistence**: no database migration — none was needed, the gate was never approached. **Wave 5-8 freeze**: no Decision/Goal/Outcome/Learning table touched; representative Wave 4B/5/8 regression (10 smokes) re-run this slice, all green.

## 33. Files changed

`src/oyi-core/domains/knowledge/backendInstitutionalKnowledge.ts` (added `backend:corporate-development`, corrected `backend:corporate-partnerships` wording), `src/oyi-core/policy/corporatePublicConversationPolicy.ts` (converged 2 branches, made `answerFor`/`buildCorporatePublicResponse` async), `src/routes/officeExport.ts` (1-line await), `scripts/wave9-slice1-canonical-knowledge-authority-smoke.mjs` (2 count assertions updated: Development query now returns 1 item, source-unavailable count now 5), `scripts/wave9-slice2-institutional-knowledge-convergence-smoke.mjs` (count updated to 5, development test rewritten to reflect the new identity item), `scripts/corporate-public-integration-smoke.mjs` (2 `await` additions), `scripts/wave9-slice3-knowledge-source-convergence-smoke.mjs` (new, 11 checks), `package.json` (new smoke script entry), `docs/WAVE9_SLICE3_KNOWLEDGE_SOURCE_CONVERGENCE_AND_AGENT_ADOPTION.md` (this file). Office: no changes.

## 34. Tests/results

`npm run typecheck` clean, `npm run build` clean. Slice 1 smoke 19/19, Slice 2 smoke 21/21, new Slice 3 smoke 11/11, `corporate-public-integration-smoke` PASS, `corporate-intelligence-contract-smoke` PASS. Representative Wave 4B/5/8 regression (10 smokes spanning device/scheduler/system authority and outcome-evaluator slices) all green, unmodified.

## 35. Environment failures

None new. (Wave 5 slice3/4 DB-dependent smokes, requiring a local Supabase instance not configured here, remain a pre-existing, unrelated environment limitation — not run, consistent with Slice 2's own disclosure.)

## 36. Newly discovered gaps (for Slice 4+)

1. Office pack's internal 5-way "what is Oyi" product-positioning contradiction (§6) — the single largest remaining duplication surface.
2. `websites-positioning-and-deployments.md` and `website-messaging.md` cite a stale site navigation/IA — flagged STALE, not corrected (would require deeper website-vs-pack reconciliation than this slice's scope).
3. No canonical items exist yet for Facility OS / Consumer OS / Edge / Camera / Digital Twin as product concepts — Oma/Osa answering those questions today draws entirely on the (internally contradictory) Office pack, with no Backend-native fallback.
4. Facility/Consumer have zero authored domain-knowledge content — any future adoption is a content-authoring exercise, not a migration.

## 37-40. Backend commit, Office commit, convergence status, readiness

Backend commit: created after this document (see final report for SHA). Office commit: none required. Knowledge Source Authority: **CONVERGED for the explicit named targets** (A, B, C fully resolved; D's duplication sweep and adoption audit complete as classification, per the task's own explicit "do not migrate yet" instruction). Deep Product/Technical Knowledge convergence readiness: **not yet** — gap #1 above (the Oyi product-positioning contradiction) should close first, since it is the clearest remaining case of "more than one place allowed to be true" for a single fact.

## 41-42. Slice 4 objective

Resolve the Office pack's internal "what is Oyi" product-positioning contradiction (§6/§36.1) — assign one canonical owner among `oyi-solution-map.md`/`commercial-proposal-logic.md`/`ochiga-overview.md`/`osa-sales-narrative.md` (or synthesize one new canonical product-positioning item, following the exact `backend:corporate-*` pattern proven safe across Slices 2-3), then reconcile the 2 STALE website-navigation files against the live site. Only after that begin authoring any real Facility/Consumer domain-knowledge content (§19-20), since this slice found there is none to migrate yet — Slice 4/5 would be the first slice to *create* new knowledge for those roles rather than converge existing hardcodes.
