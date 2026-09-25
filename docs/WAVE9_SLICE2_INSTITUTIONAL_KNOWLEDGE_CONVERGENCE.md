# Wave 9 — Slice 2: Institutional Knowledge Convergence

Status: LOCAL ONLY. Not pushed, not deployed. Backend HEAD at time of writing: `27787de` (prior to this slice's own uncommitted work). Office HEAD: `e85b17b` (no Office code changes this slice).

## 1. Mission recap

Slice 1 built the canonical knowledge retrieval contract (`KnowledgeItem`, `retrieveKnowledge()`, the Office-pack index) but left a real defect standing: `OfficeCorporateCapabilityModules.ts` carried five hardcoded corporate answers (`corporate.company/oyi/private/partnerships/development.read`) as independent string literals, with no relationship to the new canonical contract. Slice 2's job was to converge those onto ONE authority per fact — "one corporate fact should not have hardcoded answer + knowledge pack answer as independent authorities" — without deleting behavior, without inventing claims, and without touching Oma/Osa's prompts, memory, or new capabilities.

## 2. What was converged, and what was correctly left alone

| Module | Fact type | Disposition |
|---|---|---|
| `corporate.company.read` | Static institutional identity | **Converged** → `backend:corporate-company` |
| `corporate.oyi.read` | Static institutional identity | **Converged** → `backend:corporate-oyi` |
| `corporate.private.read` | Static institutional identity + compliance disclaimer | **Converged** → `backend:corporate-private` |
| `corporate.partnerships.read` | Static institutional identity | **Converged** → `backend:corporate-partnerships` |
| `corporate.development.read` | **Live** fetch from Website's public Sanity CDN (current project listings) | **Left untouched** — this is LIVE STATE, not institutional knowledge, per the locked semantic model. Converting it would have made "institutional knowledge" silently mean "whatever Sanity returns right now," which is exactly the boundary violation the task warned against. |

Mechanism: each of the 4 converged modules kept its exact original literal as a `_FALLBACK` constant. `collect()` is now `async`, calls `getKnowledgeItemByCanonicalKey(canonicalKey, actor)` — the new deterministic, authorization-checked, exact-match lookup added this slice — and falls back to the literal on `null`/thrown error. `answer()` reads the resolved text via `corporateEvidenceText()`. This is the same async-collect/sync-answer shape the codebase already used for `corporate.development.read`, so no new pattern was introduced.

The canonical items live in a new file, `src/oyi-core/domains/knowledge/backendInstitutionalKnowledge.ts` — `BACKEND_INSTITUTIONAL_KNOWLEDGE_ITEMS`, 4 `KnowledgeItem`s, content copied byte-for-byte from the original literals (never paraphrased, to guarantee behavior preservation). `knowledgeIndex.ts`'s `buildKnowledgeIndex()` now merges these with Office's fetched pack; the Backend items are present even when Office is unreachable (`sourceOk: false` still returns them) — a genuine resilience improvement, since before this slice these 4 answers had no dependency on Office at all, and now they depend on an index that itself degrades gracefully back to them.

## 3-10. Canonical business model, by division

Sourced directly from the converged canonical items (`backendInstitutionalKnowledge.ts`) — this is the "one corporate truth" Oma, Osa, and Office internal all now read from.

### Ochiga (parent)
- **Identity**: Develops and powers intelligent places — real estate development, building technology, and strategic investment partnerships, run as one interconnected ecosystem, not three unrelated businesses.
- **Purpose**: Create physical assets (Development), operate them intelligently (Oyi), and connect capital/investors/partners to the opportunity (Private/Partnerships).
- **Customers**: Real estate developers, estate/facility managers, residential communities, property companies (Oyi side); investors, buyers, landowners, strategic partners (Private/Partnerships side).
- **Claims**: Safe to state as-is (`claimBoundary: safe_to_state`).
- **Boundaries**: No specific financial figures, no group-level revenue/valuation claims exist in canonical knowledge — none should be stated.
- **Maturity**: Operating (not pre-launch) — Oyi, at minimum, is live and running the exact assistant answering this query.

### Ochiga Development
- **Identity/purpose**: Creates the physical asset — the real-estate development arm.
- **Commercial path (conceptual only, per §6 — no CRM actions modeled here)**: A landowner/developer-facing inbound path exists in practice via `corporate.development.read`'s live Sanity-sourced project listings and via Office's real JV capability (`developmentJv.ts`, Wave 3) — that capability assesses joint-venture material events, it does not live inside this slice's static knowledge convergence, and is correctly out of scope here.
- **Boundaries**: No canonical static knowledge item describes Development's business model in the same institutional depth as Company/Oyi/Private/Partnerships — see §26 gap below.
- **Maturity**: Real, live, actively synced from the public website (Sanity).

### Oyi (Technology)
- **Identity**: Ochiga's building operating technology — the intelligence layer that helps developments continue to evolve after handover: access control, energy, climate, security. "It's the same assistant you're talking to right now, adapted for residents, facility staff and Ochiga's own developments."
- **Customers**: Estate developers, facility managers, residential communities, property companies (per Office's own `ideal-customers-and-fit.md`, cross-checked against this canonical item — consistent, not contradictory).
- **Offerings**: Access control, energy, climate and security orchestration across a property; consumer, facility, and internal surfaces of the same assistant.
- **Claims**: Safe to state.
- **Boundaries**: No voice/telephony capability exists (confirmed absent everywhere this slice looked) — nothing in canonical knowledge claims it, and nothing should.
- **Maturity**: Live and operating — this is the most mature, most concretely provable division, since the assistant itself is the proof.

### Ochiga Private
- **Identity**: A curated private real-estate investment and opportunity network connecting selected investors, buyers, landowners and strategic partners with Ochiga's development opportunities.
- **Offerings**: Five-stage membership — Apply, Qualify, Access, Participate, Grow; opportunity categories span recurring income, longer-term appreciation, and development-linked categories (named as categories, not products with fixed terms).
- **Claims/boundaries**: `claimBoundary: requires_qualification` — the item's own content carries the compliance disclaimer verbatim and must never be trimmed: "Membership and access are subject to individual review and are never guaranteed; Ochiga does not provide investment advice, and nothing here is an offer of securities or a guarantee of returns." No numeric return, yield, or guarantee may ever be stated (verified by the Slice 2 smoke's own regex check against invented percentage-return language).
- **Maturity**: Real membership funnel exists (5 real stages), but explicitly disclosed as subject to individual review, not a standing offer.

### Partnerships
- **Identity**: Ochiga partners across four tracks — Landowners & Joint Ventures, Capital Partners (institutions/family offices/strategic capital), Buyers & Offtake, and Professional/Strategic Partners (delivery/technology integrators).
- **Process**: Introduce, Review, Structure, Align, Execute.
- **Claims**: Safe to state; no funding thresholds, no approval guarantees (verified by the Slice 2 smoke).
- **Known drift** (see §20): the live website's Partnerships page now labels the fourth track "Delivery Professionals" rather than "Professional/Strategic Partners" — a wording drift, not a factual contradiction, disclosed here rather than silently rewritten.

## 11. Monetization knowledge (source-supported only)

No canonical item anywhere in the Backend-native set or the Office 27-file pack states a specific price, fee schedule, or revenue figure as an *institutional* fact for public/Oma/Osa consumption. The one place a concrete number exists — `facility-control-system.md`'s "Starter: setup fee NGN 3,500,000 and monthly NGN 180,000" — is Office-internal-only knowledge (`audience: INTERNAL_COMMERCIAL`, confirmed by Slice 1's own audience-gate proof), carries its own explicit guardrail ("Oma should not quote or negotiate from this file"), and is correctly excluded from anything PUBLIC. No new pricing knowledge was invented or added this slice. This satisfies §11's "source-supported only, never invented" requirement by construction: the only real pricing knowledge that exists stays exactly where it already was, at the audience level it was already gated to.

## 12. Opportunity-routing knowledge (conceptual only)

Conceptually, the routing shape today is: Development (JV/land conversations) → Office's real `developmentJv.ts` capability (Wave 3, live); Private (investment/membership conversations) → Office CRM opportunity creation (pre-existing, untouched); Partnerships → the same CRM path. This slice adds no new routing action, no new CRM call, and no new capability — the above is a description of existing, already-live behavior for context, not something built or modified here.

## 13. Cross-domain behavior proof

Verified structurally: `corporate.company.read`'s converged content itself spans all three engines in one answer ("three connected engines: Ochiga Development..., Oyi..., and Ochiga Private...") — a caller asking "what is Ochiga" gets one coherent cross-domain answer, not three disconnected fragments, exactly because the underlying `KnowledgeDomain` taxonomy (`corporate`, `technology`, `private`, `partnerships`, `development`) still lets `retrieveKnowledge()`'s free-text path (Slice 1) pull items from multiple domains for a cross-cutting query, while the exact-key path (Slice 2, used by the capability modules) stays domain-precise for a single named fact.

## 14. Safe-claims convergence

Verified by the new Slice 2 smoke (`wave9-slice2-institutional-knowledge-convergence-smoke.mjs`, checks 9): `backend:corporate-private` contains no numeric-return promise pattern and carries the disclaimer verbatim; `backend:corporate-partnerships` contains no invented funding threshold or approval guarantee. Both converged items keep their pre-existing safe-claim posture unchanged — convergence changed *where* the text is stored and *how* it is fetched, never *what* it says.

## 15. Maturity classification

- **Live/operating**: Oyi (technology) — self-evidently, since it is answering this query; Development — live Sanity-synced project data.
- **Real but reviewed/gated**: Ochiga Private (5-stage funnel, explicitly disclosed as subject to review, never guaranteed).
- **Real, process-defined**: Partnerships (4 tracks, 5-stage process).
- **Confirmed absent, correctly not claimed anywhere in canonical knowledge**: voice/telephony capability. No canonical item, converged or Office-pack, states Oma/Osa can place or receive calls. This was checked directly this slice and remains true after convergence — convergence did not introduce any overclaim.

## 16. Source-authority resolution

Authority ordering is unchanged from Slice 1 (`KNOWLEDGE_AUTHORITY_RANK`: `APPROVED_INSTITUTIONAL > TECHNICAL_SOURCE > APPROVED_COMMERCIAL > PRODUCT_SOURCE > PROJECT_SOURCE > MARKETING_REFERENCE > UNVERIFIED_REFERENCE`). All 4 converged Backend-native items are `APPROVED_INSTITUTIONAL` — the highest rank, consistent with the fact that they are the same content that previously had unconditional, un-ranked authority as hardcoded literals. No authority-ordering change was needed or made; convergence only removed the *duplicate, un-ranked* second copy that used to live outside the contract entirely.

## 17. A second, independent hardcoded corporate-fact source — found, not converged, disclosed

Direct grep of `src/oyi-core` for prompt-assembly patterns found no monolithic Oma/Osa system-prompt file (Oma/Osa are capability-routed, not prompt-blob-assembled). It did find a **second** hardcoded corporate-fact source, distinct from `OfficeCorporateCapabilityModules.ts`: `src/oyi-core/policy/corporatePublicConversationPolicy.ts`'s `answerFor()` function (~lines 61-75) — regex-triggered fallback strings for "what is Ochiga" / "what is Oyi" / business-unit routing, hand-written and **not** byte-identical to the canonical items (notably, its Oyi description diverges materially: "living intelligence and operating layer... connect physical infrastructure to safer digital action" vs. the canonical "building operating technology... powers access control, energy, climate and security").

This is **not currently a live competing authority** in practice: the function's own logic checks `canonical.reply`/`canonical.answer` first and returns immediately if either is populated (L58-59) — and since the Slice 2-converged capability modules now populate exactly that field for these two questions, this fallback block is dead code for "what is Ochiga"/"what is Oyi" today. It is, however, a **latent second authority**: if the capability pipeline ever failed to populate `canonical.reply` (a routing bug, a swallowed exception upstream), this block would silently reactivate with non-canonical wording. Per the explicit stop condition against modifying prompts/building new capabilities this slice, **this was not touched**. It is flagged here as the clearest concrete Slice 3 candidate (retire the literal fallback in favor of the same `getKnowledgeItemByCanonicalKey` pattern, or delete it once dead-code status is confirmed over a longer window).

## 18. Website-vs-canonical comparison (not rewritten)

Checked all 4 claimed source pages in `Ochiga-website` directly:

| Canonical item | Live source | Result |
|---|---|---|
| `backend:corporate-company` | `app/about/page.tsx` | Matches — "three connected engines" framing present, no material drift. |
| `backend:corporate-oyi` | `lib/company.ts` / `app/about/page.tsx` | Matches — "building operating technology" framing consistent, no standalone `/oyi` page to diverge from. |
| `backend:corporate-private` | `app/private/page.tsx` | **Exact match** — all 5 stage names/descriptions verbatim-equivalent. |
| `backend:corporate-partnerships` | `app/partnerships/page.tsx` | Process stages exact match. **One label drift**: live page's fourth partner-type card now reads "Delivery Professionals," canonical item says "Professional/Strategic Partners" — wording drift only, same underlying category (delivery/technology integrators), not a factual contradiction. |

Per the task's own explicit instruction ("do not rewrite websites unless absolutely required"), this drift was not corrected in either direction this slice — it is disclosed as a known gap (§26).

## 19. Public/internal boundary — proof

Structural proof (Slice 2 smoke, check 6): `buildOfficeInternalReadCapabilities()` — the staff-facing CRM/ops registry — contains none of the 4 converged `corporate.*.read` keys. They remain public-surface-only, registered exclusively through `buildPublicCorporateReadCapabilities()`, exactly as before convergence. Authorization proof (Slice 2 smoke, check 8): `getKnowledgeItemByCanonicalKey` still enforces `agentVisibility` on Backend-native items exactly as it does on Office-pack items — an actor role outside `[oma, osa, office_internal, executive]` (e.g. `facility`) receives `null`, never the fact.

## 20. One-corporate-truth proof

Structural, not incidental: `ConversationOrchestrator.ts:121` registers Oma and Osa's public-corporate surface from the **same** `buildPublicCorporateReadCapabilities()` call — there is only one registry, so "one corporate truth" holds by construction, not by convention. Smoke check 2 proves this behaviorally: calling the builder twice (simulating two independent conversation turns) yields byte-identical answers for all 4 converged facts.

## 21. Security review

- Every converged module carries `risk_class: "read"` and `permission_requirements: []` — a knowledge fact is never itself a capability grant (Slice 2 smoke check 7).
- Authorization gate (`audienceAllowed` + `agentAllowed`) runs identically for Backend-native and Office-pack items — no bypass path was introduced for the "trusted" static items (Slice 2 smoke check 8).
- Fallback-on-failure never fabricates new content — it returns the exact pre-existing literal, the same text that was already safe to show before this slice existed (Slice 2 smoke check 3).
- No new network calls, no new external dependency, no new write path was introduced by this slice.

## 22-25. Regression evidence

Full commands and results:
- `npm run typecheck` — clean.
- `npm run build` — clean.
- `node scripts/wave9-slice1-canonical-knowledge-authority-smoke.mjs` — 19/19 passed (2 assertions updated to reflect Slice 2's intentional new behavior: the Private-domain query now legitimately returns the 1 converged item instead of 0; the Office-unreachable case now legitimately returns the 4 Backend-native items instead of 0 — both are correct, intended consequences of this slice's own design, not regressions).
- `node scripts/wave9-slice2-institutional-knowledge-convergence-smoke.mjs` (new, 16 checks) — all passed.
- Representative Wave 4B/5/8 regression (`smoke:corporate-intelligence-contract`, `smoke:corporate-public-integration`, `smoke:wave4b-slice1/2-*`, `smoke:wave5-slice1/2-*`, `smoke:wave8-slice1..6-*`) — all passed unmodified. (`wave5-slice3/4` require a local Supabase instance with `OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY` not configured in this environment — a pre-existing environment limitation unrelated to this slice's changes, not run.)
- Office: `git status` confirms zero Office source changes this slice (only the same pre-existing untracked `supabase/` noise present at session start) — no Office regression suite needed, none was run.

## 26. Known remaining gaps (disclosed, not fixed this slice)

1. **`corporatePublicConversationPolicy.ts`'s latent second hardcoded fact source** (§17) — dead today, should be converged onto `getKnowledgeItemByCanonicalKey` or deleted in a future slice.
2. **Partnerships label drift**: "Professional/Strategic Partners" (canonical) vs. "Delivery Professionals" (live website) — needs a decision (update canonical wording to match, or confirm the canonical name is still the intended institutional name and the website should follow).
3. **Development division has no canonical static knowledge item** describing its business model at the same depth as Company/Oyi/Private/Partnerships — only its live Sanity feed exists. Whether a *static* institutional item (separate from the live listing) is warranted is a Slice 3 question, not resolved here.
4. Office's 27-file knowledge pack was not re-audited item-by-item for duplication against the now-5-item Backend-native set beyond the 4 explicitly converged facts — a full duplication sweep (§26 of the task) was scoped to the known hardcoded modules, which is the convergence target this slice was asked to close; a broader pack-wide duplication audit is a reasonable Slice 3 candidate.

## Proposed Slice 3 objective

Retire (or converge) `corporatePublicConversationPolicy.ts`'s latent hardcoded fallback block onto the same canonical-lookup pattern now proven in `OfficeCorporateCapabilityModules.ts`, closing the one remaining "second authority" this slice found but was scoped not to touch — paired with a decision + resolution on the Partnerships naming drift (§26.2), and only after both: begin the Facility/Consumer knowledge-adoption classification work explicitly deferred by this slice's own stop condition ("DO NOT UPDATE FACILITY/CONSUMER YET").
