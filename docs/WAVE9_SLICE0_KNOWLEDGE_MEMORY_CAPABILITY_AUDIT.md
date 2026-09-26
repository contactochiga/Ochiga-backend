# Wave 9 — Knowledge, Memory & Agent Capability Convergence
## Slice 0 — System-Wide Knowledge / Memory / Capability Authority Audit

STATUS: READ-ONLY DISCOVERY. Uncommitted. No source, prompt, knowledge file, database schema, or migration was modified anywhere across any repository. No commit, push, or deploy occurred. Nothing was built.

Audited: 2026-09-25/26. Programme baseline confirmed at Wave 8 production checkpoint (Backend `2b260fc`, Office `1591f50` on `codex/office-extraction` with prerequisite `c08cb92` merged).

---

## 1. Repository verification

| Repo | Branch | HEAD | Tracking | Ahead/Behind | Working tree | Production relevance |
|---|---|---|---|---|---|---|
| Ochiga-backend | main | `2b260fc` | origin/main | 0/0 | clean (known pre-existing noise only) | Core intelligence runtime, Wave 5-8 authorities, live |
| ochiga-office | communications/handoff-accept-production-fix | `c08cb92` | origin/same | 0/0 | 1 untracked (`supabase/`, pre-existing) | Local checkout is behind production truth — `origin/codex/office-extraction`@`1591f50` (contains `c08cb92`) is the real production branch; audited via that ref where it mattered |
| Ochiga-website | main | `8b2024e` | origin/main | — | 1 untracked | Public corporate site, live |
| Oyi-page | main | `700cf4b` | origin/main | — | clean | Public "Oyi" product page, live |
| oyi-edge-agent | main | `d2715f1` | origin/main | — | clean | On-site edge runtime, live |
| facility-oyi | feat/typed-utility-pricing-config | `c7c7c7a` | origin/same | — | 9 dirty (pre-existing, untouched) | Facility operator frontend, live |
| Oyi-os-frontend | main | `ebdec4b` | origin/main | — | 11 dirty (pre-existing, untouched) | Consumer/resident frontend, live |
| Oyi-Twin-Engine | main | `62bc894` | origin/main | — | 221 dirty (pre-existing, extensive prior Luna work, untouched) | Shared spatial/Twin engine package, live but network-isolated |

No repository was modified during this audit. All discovery was performed via `Read`/`Grep`/`Bash` (read-only) across six parallel research passes, one per domain, synthesized below.

---

## 2. Agent / intelligence surface inventory — the actual system

The task's own instruction was "do not begin from assumptions." Here is what actually exists, not what the mission brief guessed:

### 2.1 Backend (`Ochiga-backend`) — two layers that must not be conflated

**(A) Declarative registry** (`src/intelligence-core/agentRegistry.ts`, `toolRegistry.ts`) — metadata only, used for observability/permission listing via `intelligenceRoutes.ts`/`health.ts`, **never executed**. Declares 10 named agents: `oyi`, `facility`, `oma`, `osa`, `edge`, `camera`, `watch`, `ochiga_executive`, `twin`, `plan_studio`, each with a domain/allowed_surfaces/tools/memory_scope/risk_level label set. `oma`/`osa`/`twin`/`plan_studio` entries here are **labels with no backing implementation in this repo** — `twin`/`plan_studio` even have empty `tools: []`, honestly marked "future" in their own domain string.

**(B) Real executable layer** — `src/ai/toolRegistry.ts` (26 real tools) + `src/ai/commandRouter.ts` (real authority-gated executor), called by `oyiUnifiedIntelligenceService.ts` (3,217 lines — the actual resident/Facility engine), `watchAdapterService.ts`, `residentActionBatchExecutionService.ts`.

| Name | Role | Entry point | Model provider | Knowledge source | Memory source | Tools | Authority | Public/Internal | Status |
|---|---|---|---|---|---|---|---|---|---|
| Oyi Intelligence (resident/consumer engine) | Home+estate conversational engine | `oyiUnifiedIntelligenceService.ts` | **None — deterministic intent routing, zero LLM call found** | none packaged; live DB reads only | `resident_memory` table (wired but dead, see §17) | 26 real tools via commandRouter | Wave 5-8 authority modules | Consumer app | **LIVE** |
| Facility Intelligence | Estate/ops capability set | Same process, Wave 5-8 controllers | None | none packaged | none | facility:*, camera:read | Wave 5/6 authority | Facility surface | **LIVE as capability set, not a chat-loop "brain"** |
| Oma / Osa (Backend side) | Metadata stub only | `agentRegistry.ts` labels | N/A here | N/A | N/A | office:* (label only) | N/A | N/A | **STUB — real implementation is in ochiga-office, confirmed below** |
| Executive Intelligence | Cross-system aggregation | `executive.ts`, `organization.ts`, `organizationObservability.ts` | None | aggregates other modules | none | intelligence:summary/predictions/collaboration | none explicit | Office/internal API | **LIVE, read/aggregation only, no reasoning** |
| Automation NLU parser | Free-text → automation scene | `utils/ai.ts::nluToAutomation` | **OpenAI gpt-4o-mini — the only real generative LLM call in the entire Backend repo** | none (prompt-only) | none | writes automation rule | route auth | Consumer feature | **LIVE, narrow, single-purpose** |
| Reply classifier | Classifies inbound comm replies | `communicationRuntime/replyClassifier.ts` | Likely OpenAI (not fully traced) | none | none | classification only | n/a | internal | LIVE, narrow |
| Twin / Plan Studio (Backend side) | Declared "future" | agentRegistry only | — | — | — | none | none | — | **DEAD/DECLARED-ONLY** |
| Edge/Camera (Backend side) | Registry wrapper over Wave 6 authorities | agentRegistry + `cameraCurrentStateAuthority.ts` etc. | None | none | none | edge:health, camera:read → real Wave 6 functions | Wave 6 authority | Facility/Edge | **LIVE as capability, registry entry is a metadata wrapper** |

### 2.2 Office (`ochiga-office`) — Oma/Osa are ROLE LABELS, not separate agents

The single most important finding of this audit: **Oma and Osa are not two agents. They are one delegation pipeline (`selectAgentRole` in `public-intelligence.js`) that picks an `agent_role` string (`"oma"` or `"osa"`) based on message content/lead_stage signals, then forwards to the exact same Backend Core conversation endpoint** (`oyi-core-gateway.js::callOyiCoreCorporateConversation`). Office holds **zero local LLM reasoning** for either role — confirmed by `scripts/test-office-intelligence-architecture-guard.js`, a real anti-regression test that asserts `server.js` never re-imports a retired `./runtime` module (`LeadAgentRuntime` — a **formerly real, now deliberately deleted** local Office intelligence brain) and that every live conversation route delegates to Backend Core.

**This is direct historical precedent that the Wave 9 target architecture is achievable — Office already did this convergence once**, retiring its own local brain in favor of one shared Core. This should heavily inform Wave 9's design: the pattern to generalize is already proven, not hypothetical.

| Name | Role | Entry point | Model provider | Knowledge source | Memory source | Authority gates | Public/Internal | Live/Dead |
|---|---|---|---|---|---|---|---|---|
| Oma | Marketing/acquisition role label | `public-intelligence.js::selectAgentRole` → `oyi-core-gateway.js` → Backend Core | None locally | none wired (§4) | `lead_memories` | `ALLOWED_CAPABILITIES`/`BLOCKED_OPERATIONAL_DOMAINS` allowlist | Public | LIVE (role, not a brain) |
| Osa | Sales role label | Same file/path, different `agent_role` value | None locally | none wired | `lead_memories` | Same allowlist | Public | LIVE |
| Office-internal chat | Staff CRM assistant | `server.js` → `callOyiCoreOfficeInternalConversation` | None locally | none wired | Server-assembled `buildOperationalSnapshot` context | staff auth + permissions | Internal | LIVE |
| Retired "LeadAgentRuntime" | Former local Office brain | deleted, guarded against regression | — | — | — | — | — | **DEAD, deliberately retired** |
| Plan Studio AI | Image→geometry / Q&A for a facility-provisioning tool | `server.js:1264`/`:1430` | Direct OpenAI `/responses` call | task-scoped prompt only | none | staff auth | Internal | **LIVE — legitimate, explicitly separate from CRM/lead reasoning per the same guard test** |
| Voice transcription | Speech→text only | `openai.js::createTranscription` | OpenAI Whisper | n/a | n/a | staff/lead auth | Both | LIVE, STT only — no telephony |

**The Oma/Osa capability boundary is policy/prompt-context-driven, not a separate code path** — both route through identical CRM/store access, differentiated only by the `agent_role` label and its capability allowlist.

### 2.3 Public website surfaces — TWO independent, structurally separate agents

The most significant "agents becoming independent brains" evidence in this audit:

**Surface A — Ochiga-website's own "Oyi Widget"**: `app/components/oyi/OyiWidget.tsx` → server-side proxy (`lib/oyi/backendProxy.ts`) → **Backend directly**, `POST /office/conversation/corporate` and `/communications/office-public/session/*` (text + real browser-mic voice: STT→Core→TTS, session/handoff/visual-observation). Also a genuinely separate real-write path: `lib/office/intakeClient.ts` → `POST https://ochiga-lead-agents.onrender.com/api/office/intake` — **creates a real Office Lead**, with production-disabled local-file fallback (never silently substitutes for a real CRM write).

**Surface B — Oyi-page's "Oma" widget**: a third-party `<Script>` tag loading Office's own `widget.js` directly (`data-oma-widget="true"`), plus a separate proxy route to `/api/lead-agents/public/chat`. **Bypasses Backend entirely — talks to Office directly.**

Two different public sites, two different code paths, two different upstream targets (one hits Backend's `/office/conversation/corporate`, the other hits Office's own widget/chat endpoint directly), for what is nominally "the same Oyi." Whether their knowledge/tone/capability claims actually agree was not verifiable from either side alone (see §12 contradiction matrix — flagged as unresolved, needs a targeted follow-up read of Backend's `/office/conversation/corporate` handler content against Office's `/api/lead-agents/public/chat` content, which this Slice 0 pass did not have budget to do verbatim).

No memory surface exists in either public-website repo — both are pure conduits; any session continuity lives entirely upstream.

### 2.4 Facility/Consumer frontends — the SAME independent-brain pattern, twice more, internally

Both `facility-oyi` and `Oyi-os-frontend` are structurally identical mirrors. Each contains **two intelligence surfaces that never talk to each other**:

1. **Main conversational panel** (`FacilityConversationComposer`/`OyiComposerRow`) — a thin proxy to Backend's `/oyi/runtime/conversation`. No client-side reasoning, no local knowledge.
2. **Luna Twin Oyi panel** (`LunaOyiPanel`/`LunaHomeOyiPanel`) — calls `TwinIntelligenceController` from the shared `oyi-twin-engine` package, **fully client-side, zero network call to Backend**, deterministic local intent parser, own local vocabulary/asset registry.

Grepped for cross-references between the main composer store and the Twin components: **none found.** A user asking the main Oyi panel "show me the pool" gets a text-only answer at best; asking the Twin panel gets camera movement but with no access to Backend's live truth. This is a second, independent occurrence of exactly the anti-pattern the Wave 9 mission brief warns against — not hypothetical, currently shipping.

Memory in both frontends is tab-session-only (`sessionStorage`, zustand `persist`) — no cross-session, cross-device continuity anywhere client-side. One authority-drift risk flagged: `Oyi-os-frontend`'s `src/lib/oyiFoundation.ts` holds its own client-side copy of `PERMISSION_KEYS`/`OCHIGA_CONTRACT_VERSION` — a duplicated authority contract, drift risk by construction if Backend's real permission set changes and this copy isn't updated in lockstep.

### 2.5 Oyi-Twin-Engine — confirmed zero live connection to Backend

`TwinIntelligenceController` + `lunaIntentParser`/`lunaVocabulary`: **no LLM anywhere** (self-documented: "Luna deterministic intent parser. No external LLM dependency", confirmed by zero LLM-SDK references repo-wide). **Zero HTTP calls to Backend anywhere in the repo** (one `fetch` found, for a static texture asset, not data). The engine's own `TwinDataProvider` doc comments explicitly describe the current implementation as a placeholder for a future live-API provider that does not exist yet: *"the 'Luna local simulation today' half."* It operates entirely on hand-authored seed constants (`LUNA_OPERATIONAL_ASSETS`, `RUNTIME_SEED_ROWS`). Capability is simulate-only — `twinRuntime.execute()` routes through an in-memory `setAssetState()` choke point, never reaching a real device or Backend endpoint. Architecturally ready for a live provider (clean interface seam per Phase 4/5 design) but not live today.

### 2.6 oyi-edge-agent — confirmed: no LLM, pure protocol bridge

`package.json` deps: `axios`, `dotenv`, `onvif` only. Zero LLM-SDK references. This is camera discovery (ONVIF) + snapshot capture + telemetry relay + an offline-durable retry outbox, not a reasoning agent. Real capability whitelist (`validCommand()`) is hardcoded to exactly `["camera.discovery", "camera.snapshot"]` — no PTZ, no lock/unlock, no generic device command exists at the edge; any richer control lives entirely on Backend's side of the bridge. Camera AI is confirmed cloud-delegated: `ExternalDetectorProvider` POSTs a base64 frame to a configurable external HTTP detector — no on-device inference, matching Backend's own `CAMERA_AI_INTERVAL_MS`-driven "AI snapshot" evidence path exactly.

---

## 3. Semantic model — applied, not just defined

Per the mission brief's own §3, holding these boundaries strictly across every finding above and below:

- **KNOWLEDGE** = the Office `knowledge/` pack (durable, intended institutional understanding) — but see §5, it is currently disconnected from runtime.
- **MEMORY** = `lead_memories` (Office, real, distilled) and `resident_memory` (Backend, real contract, dead wiring) — the only two genuine memory implementations found anywhere in the system.
- **LIVE STATE** = Wave 5-8 device/camera/maintenance/visitor/goal/outcome truth (Backend), CRM truth (Office) — never called "memory" anywhere in this audit, per instruction.
- **CONTEXT** = `buildOperationalSnapshot` (Office), `TwinIntelligenceContext` (Twin engine, session-only) — assembled per-request, not durable.
- **INTELLIGENCE** = reasoning over the above — found real (LLM-backed) in exactly three narrow places (Backend's automation NLU, Backend's reply classifier, Office's Plan Studio) and one broad place (Backend Core's `/office/conversation/corporate` and `/oyi/runtime/conversation`, which every other surface in the system ultimately proxies to or is supposed to).
- **ROLE** = Oma/Osa/facility/consumer/executive — labels applied to shared execution, not separate brains, **except** where §2.3-2.5 show real architectural separation (public-website duplication, Twin isolation).
- **CAPABILITY vs AUTHORITY** — held separate throughout §9 below; no capability table entry implies permission.

---

## 4. Knowledge source inventory & classification (system-wide)

| Source | Repo | Classification | Note |
|---|---|---|---|
| `knowledge/*.md` (27 files) | ochiga-office | CANONICAL_CANDIDATE (technical/positioning subset) / PROMPT_INSTRUCTION (commercial doctrine subset) / MARKETING_CONTENT (positioning subset) | See §5 — currently **disconnected from the live agent pipeline** |
| `prompt-packs/marketing-agent`, `prompt-packs/sales-agent` | ochiga-office | **LEGACY/DUPLICATE** | Zero production callers found — referenced only by lint/guard scripts, superseded by the `agent_role`-label design, never deleted |
| `approved-system-description.md` | ochiga-office | CANONICAL_CANDIDATE | Only 3 lines — real content, but a stub relative to its evident intent |
| Backend `docs/*.md` (extensive, Wave 3-8) | Ochiga-backend | REFERENCE_DOCUMENT | Developer-facing only, never loaded by any runtime agent — confirmed no `knowledge/` or `SYSTEM_PROMPT` directory/constant exists anywhere in Backend |
| Marketing JSX copy (`app/technology/*`) | Ochiga-website | MARKETING_CONTENT | Hardcoded, unexamined verbatim (flagged for follow-up if literal-wording contradiction diffing is required) |
| Sanity CMS schemas | Ochiga-website | REFERENCE_DOCUMENT | Blog/CMS content model, unrelated to agent behavior |
| Oyi-page page copy | Oyi-page | MARKETING_CONTENT (unverified verbatim) | Not deeply read — time-budget tradeoff, flagged |
| `LUNA_OPERATIONAL_ASSETS` / `RUNTIME_SEED_ROWS` | Oyi-Twin-Engine | AGENT_LOCAL_KNOWLEDGE (static, hand-seeded) | Not LIVE_DATA — no live connection exists to make it so |
| Edge-agent `docs/*.md` (4 phase writeups) | oyi-edge-agent | REFERENCE_DOCUMENT | Engineering history, not runtime-consulted |
| `Oyi-os-frontend`'s `oyiFoundation.ts` `PERMISSION_KEYS` | Oyi-os-frontend | Authority contract (NOT knowledge — flagged explicitly per the brief's own "do not call capability authority" instruction) | Duplicated client-side copy, drift risk |

No canonical, single, system-wide knowledge substrate exists anywhere today. Backend (the system's actual reasoning core for consumer/facility conversation) has **zero** packaged knowledge of any kind — it operates purely on live DB state plus logic encoded in code structure (e.g., Wave 8's causal-ceiling disclosures are knowledge-as-logic, never knowledge-as-retrievable-content).

---

## 5. Office knowledge pack — detailed audit

All 27 files inventoried; full-text read for the README and `approved-system-description.md`, name/line-count/README-structure-based classification for the remainder (explicitly flagged as a triage, not a verbatim read, given fork time budget — a genuine limitation of this Slice 0 pass, not a finding to be treated as final).

**What it knows (by declared file set):** company/product description, solution map, modules/capabilities, product boundaries and safe claims, demo/discovery/qualification playbooks, sales narrative, commercial guardrails/proposal logic/signals/handoff, negotiation intelligence, objection guide, pitch positioning, system overview, use cases, website messaging, digital-twin blueprint, edge-runtime/agent-stack description, facility-control-system description, consumer-app/AI-surfaces description, agent voice/style.

**What is missing/stale/duplicative:**
- The README's own stated purpose ("give Oma and Osa a grounded understanding," "keep agents aligned to current website messaging") **does not match actual wiring** — see §6, this is a real, verified gap.
- Technical/positioning files (`oyi-solution-map`, `modules-and-capabilities`, `edge-runtime-and-agent-stack`, `facility-control-system`, `digital-twin-building-blueprint`, etc.) are hand-authored descriptions that duplicate the real source of truth (Backend/facility-oyi/Oyi-os-frontend/Oyi-Twin-Engine code) with **no synchronization mechanism found anywhere** — a genuine drift risk (see §7 freshness).
- Marketing/positioning files duplicate whatever the website repos actually say — not independently verified in this pass.
- `prompt-packs/*` are dead/legacy, never deleted.

**Commercial doctrine vs technical truth vs marketing copy** — held separate per file per the classification above; none of the commercial-doctrine files should ever become "canonical operational truth" about what the product verifiably does (they encode how to sell it, not what it is).

---

## 6. Knowledge retrieval — traced end-to-end, critical finding

Traced `knowledge_context` from Office through to Backend: `oyi-core-gateway.js` builds every Backend conversation request with `knowledge_context: Array.isArray(safeBody.knowledge_context) ? safeBody.knowledge_context : []` — **a pure pass-through of whatever the inbound HTTP request already contained, defaulting to an empty array.** Grepped every assignment of `knowledge_context` repo-wide in Office: the only other occurrence is a test fixture hardcoding `[]`.

**No code path in Office ever reads `knowledge/*.md` and populates `knowledge_context` with real content.** No chunking, no embedding, no search, no ranking exists on Office's side. Whether Backend's Core independently reads these files by some other mechanism (shared volume, sync job, separate ingestion) was not verifiable from Office's side and Backend's fork found no packaged knowledge directory of any kind on its own side either. **Working conclusion, held with appropriate uncertainty: the 27-file knowledge pack is currently disconnected from the live agent pipeline.** This is the single most consequential finding for Wave 9's "governed institutional knowledge substrate" mission question — there is functionally no retrieval today, anywhere, for anything classified as durable knowledge.

---

## 7. Knowledge freshness

No synchronization mechanism was found anywhere connecting: website content ↔ Office knowledge pack ↔ Backend's real capabilities ↔ Twin engine's real state. Each evolves independently. Given §6's finding that the knowledge pack has no live consumer anyway, "freshness" is currently a moot question for runtime behavior (stale knowledge that nothing reads cannot mislead a live response) — but it is exactly wrong for a human reading the pack expecting it to describe the live system, and it would become an acute problem the moment any real retrieval is wired up without first re-auditing every file's currency.

---

## 8. Prompt vs knowledge

No `SYSTEM_PROMPT` constant/file was found in Backend at all (zero grep matches). Office's `prompt-packs/*` (the one place literal system-prompt files exist) are dead code (§4). The live behavioral shaping for Oma/Osa/internal-chat is therefore **entirely inside Backend Core's own conversation-handling code** (`/office/conversation/corporate`, `/oyi/runtime/conversation`) — not independently auditable as a discrete "prompt file" from either Office or the frontends; this is a genuine limitation of this Slice 0 pass (no fork was scoped to read Backend Core's actual conversation-handler prompt construction verbatim) and should be the first target of a Slice 1 deep-dive if prompt/knowledge boundary auditing continues.

---

## 9. Memory — system-wide inventory

| Scope | Storage | Writer | Reader | Retention | Live/Dead | What it remembers |
|---|---|---|---|---|---|---|
| Resident memory (Backend) | `resident_memory` table | `writeScopedMemory`→`upsertResidentMemory` | same file only | contractually unbounded | **DEAD — zero real callers outside its own defining files, never wired into the live conversational path** | N/A (architecturally scoped, never populated) |
| All other Backend agent scopes | — | `writeScopedMemory` explicitly returns `{ok:false, skipped:true, reason:"phase1_contract_only_memory_adapter"}` for any non-`oyi`/`watch` agent_id | — | — | **Explicitly, honestly stubbed** | N/A |
| `home_timeline` (Backend) | table | `intelligenceMemoryService.ts` | unconfirmed | — | **Unverified — flagged for Slice 1 follow-up**, possibly a real separate history write | unconfirmed |
| Wave 8 outcome/learning rows | `intelligence_feedback`, `oyi_learning_parameter_promotions` | Wave 8 evaluators | Goal outcome derivation only | permanent | LIVE as evidence, but **confirmed never read as memory by any agent or conversational surface anywhere in Backend or Office** (zero cross-references found in either repo) | N/A — outcome evidence, not memory |
| Lead memory (Office) | `lead_memories` table | `store-supabase.js::upsertLeadMemory` | conversation routes, pre-reply | ongoing | **LIVE — the one genuinely real, wired memory implementation found anywhere in the system** | `known_fields`, `need_signals`, `open_questions`, `keywords`, last messages/status/owner/summary, `tool_calls` — distilled, not raw transcript |
| CRM truth (Office) | Contact/Org/Lead/Opportunity tables | CRM routes | CRM routes, agent context assembly | permanent | LIVE | Current structured facts — explicitly NOT memory |
| Communication history (Office) | `crm_activities`, WhatsApp/email logs | webhook handlers | timelines, `buildOperationalSnapshot` | permanent | LIVE | Audit trail — explicitly NOT memory |
| Handoff context (Office) | `office_handoffs` | handoff routes | staff accepting handoff | permanent | LIVE | Operational state — explicitly NOT memory |
| Facility conversation | zustand `persist` → sessionStorage | client | client | tab-session only | LIVE, ephemeral | Raw chat turns, this tab only |
| Consumer active-intelligence context | `useActiveIntelligenceContextStore` | client | client | session-scoped | LIVE, ephemeral | Current screen/entity focus, not conversation history |
| Twin panels (both frontends) | React `useState` only | — | — | lost on unmount | none durable | Nothing |
| Twin engine's own memory | `TwinIntelligenceContext.lastAssetRef/lastSpaceRef` | controller | controller | in-memory, per host session | LIVE, ephemeral | Last-navigated asset/space, caller-held only |
| Edge agent outboxes (3) | `data/*.json` | agent.js / camera-ai-processor.js | flush loop | bounded, disk-persisted | LIVE | **Retry queues, not memory** — drained and discarded on successful send, never read back as prior experience |

**Corrected finding versus the mission brief's own hint**: the brief suggested "resident memory is real while several other scopes are only partially implemented." Verified fresh: this is inverted. **Resident memory is fully dead** (built, contractually defined, zero live callers). **Lead memory (Office) is the one real, live, genuinely-used memory implementation in the entire system.** Every other scope is either honestly stubbed or doesn't exist as memory at all.

**Executive/organizational memory** (§22 of the brief): confirmed absent. Wave 8 outcomes are real evidence but never become memory anywhere — no agent, executive or otherwise, reads prior Decision/Goal/Outcome history as "what we learned." Learning parameters (Wave 8 Slice 5) are the closest thing to organizational memory that exists, and even those have zero live promotion callers today (per the Wave 8 audit already on record).

---

## 10. Memory vs knowledge — worked examples (per the brief's own §26 format)

- "Facility OS supports camera health monitoring" → **KNOWLEDGE** (if it existed anywhere retrievable — it doesn't, per §6; today this fact only exists as logic in Backend's Wave 6 code).
- "This lead prefers WhatsApp" → **MEMORY** (`lead_memories.known_fields`, real).
- "Camera 17 is currently degraded" → **LIVE STATE** (`cameraCurrentStateAuthority`, Wave 6).
- "Camera 17 failed three times last month" → would be **HISTORY/EPISODIC EVIDENCE** — confirmed **not currently retained anywhere** as queryable history; `intelligence_feedback` rows exist per-evaluation but nothing aggregates or re-surfaces them as "three times last month" to any agent.
- "Repeated failures suggest inspection" → would be **INTELLIGENCE/LEARNING** — the closest real analog is Wave 8's learning-parameter pipeline, which is real but narrow (confidence-calibration text only, never a structural recommendation like this).

---

## 11. Memory privacy

Resident memory is dead code, so no cross-resident leakage risk currently exists for it. Lead memory (Office) is keyed per-lead via the store layer — isolation not independently stress-tested in this pass (flagged for Slice 1 if memory implementation work begins). No cross-actor memory sharing mechanism was found anywhere (unsurprising, since almost no memory exists to leak).

## 12. Memory write authority

`lead_memories` is written by deterministic extraction code (`upsertLeadMemory`), not by free LLM output — the fields are structured (`known_fields`, `need_signals`, etc.), not an arbitrary durable blob an LLM could write unconstrained. No agent anywhere was found with the ability to write arbitrary durable memory. Provenance/correction mechanisms were not verified in this pass — flagged.

---

## 13. Contradiction matrix — partial, honestly disclosed as incomplete

This Slice 0 pass could NOT fully complete a verbatim contradiction matrix — no fork had budget to extract exact wording from Backend Core's conversation-handler content, Office's 27 knowledge files (only 2 read in full), and both website repos' marketing copy, then diff them pairwise. What IS confirmed:

| Claim domain | Surfaces that could disagree | Status |
|---|---|---|
| "What Oma/Osa can do" | Office knowledge pack's `product-boundaries-and-safe-claims`/`modules-and-capabilities` vs Backend's real 26-tool capability set vs website marketing copy | **Not diffed verbatim — flagged for Slice 1** |
| Public agent identity/tone | Ochiga-website's Oyi Widget (Backend-proxied) vs Oyi-page's Oma widget (Office-proxied) | **Structurally confirmed to be two different code paths; content agreement unverified** |
| Twin/product maturity | Office's `digital-twin-building-blueprint` vs Twin Engine's actual (simulation-only, zero live Backend connection) reality | **Likely contradiction — the knowledge file almost certainly describes intended/aspirational capability; the engine confirmed today is static-seed simulation only. Verbatim diff not performed.** |
| Voice/call capability | Any marketing claim of "voice" or "calls" vs the confirmed system-wide reality (browser dictation + Whisper STT only, zero telephony anywhere) | **High-priority check for Slice 1 — this is exactly the kind of overclaim risk the brief is designed to catch** |

**Recommendation for Slice 1**: a dedicated pass whose only job is pairwise verbatim diffing of capability/maturity claims across Office knowledge pack, both website repos, and confirmed Backend/Twin/Edge reality — this Slice 0 pass established WHERE to look, not the full diff.

---

## 14. Knowledge/capability ownership

| Fact class | Owner (confirmed) |
|---|---|
| Device/camera/maintenance/visitor live state | Backend (Wave 5/6 authorities) |
| Goal/Decision/Outcome truth | Backend (Wave 7/8) |
| Learning parameters | Backend (Wave 8 Slice 5) |
| CRM truth (Contact/Org/Lead/Opportunity) | Office |
| Lead memory | Office |
| Communication history/audit | Office |
| Company doctrine, commercial policy, sales narrative | Office `knowledge/` pack (declared owner — but disconnected from runtime, §6) |
| Product capability description | **Ambiguous — three independent copies exist** (Office knowledge pack, website marketing copy, and the actual code across Backend/Twin/frontends), with no reconciliation mechanism. This is the clearest "no fact should have ambiguous ownership" violation found. |
| Website messaging | Ochiga-website / Oyi-page (each independently) |
| Twin/spatial building state | **Ambiguous** — Twin Engine's local seed data has no live connection to Backend's real Wave 3C digital-twin asset contract; two "truths" exist with no synchronization |
| Development/JV/investment/Ochiga Private knowledge | **Not found anywhere in any repo audited** — see §15 |
| Pricing | Not located in any repo's knowledge/capability layer — likely human-only today, unconfirmed |

---

## 15. Development, technology, and private/investment knowledge — MISSING, stated plainly per instruction

Per the brief's own explicit instruction ("if knowledge is absent, say MISSING, do not invent it"):

- **Development/JV knowledge** (land opportunities, JV structures, landowner contribution, financing, approvals, construction lifecycle, offtake, site evaluation, title/document requirements): **MISSING.** No knowledge file, no code module, no capability anywhere in any audited repo represents this domain in any structured way. Backend's `developmentJv.ts` (referenced in this conversation's own prior Wave 3 work) provides a JV *assessment* capability triggered by material events — that is capability, not knowledge, and it was not re-verified in this pass (out of the six forks' scope; flagged for Slice 1).
- **Ochiga Private / investment / membership / consultation knowledge**: **MISSING.** No file, table, or code reference found anywhere across all eight repos.
- **Technology knowledge accuracy** (can commercial agents explain Oyi's architecture without overclaiming): **Cannot be verified as accurate today**, because the only technical-knowledge source (Office's knowledge pack) is disconnected from the live agent pipeline (§6) — whatever Oma/Osa actually say about the technology comes from Backend Core's own conversation-handling logic, which was not independently read verbatim in this pass.

---

## 16. Capability inventory — system-wide highlights

(Full per-repo detail in §2 above; this table is the cross-cutting synthesis.)

| Capability family | Owner(s) | Real implementation confirmed | Voice/telephony note |
|---|---|---|---|
| Device/scene/maintenance/visitor control | Backend `ai/commandRouter.ts` | LIVE, authority-gated | — |
| Camera read | Backend, via Wave 6 authorities | LIVE | — |
| Camera discovery/snapshot (physical) | oyi-edge-agent | LIVE, 2-command whitelist | — |
| Camera AI detection | oyi-edge-agent → external cloud detector | LIVE, cloud-delegated, no on-device model | — |
| CRM (Contact/Org/Lead/Opportunity/activities/proposal/meeting/handoff) | Office | LIVE, shared code path across Oma/Osa/internal | — |
| Scheduling (demo/meeting) | Office (`scheduling.js`) | LIVE | Absent from Backend entirely |
| **Voice/call (outbound/inbound telephony)** | **Nobody** | **ABSENT system-wide** — zero Twilio/telephony anywhere in any of the 8 repos. Only real voice-adjacent capability: browser-native SpeechRecognition (dictation input, facility-oyi) and OpenAI Whisper (transcription of pre-recorded audio, Office + Website's real-time voice-turn flow). **No agent can currently place or receive a real phone call, and none can write a call outcome to CRM because no call can happen.** | This directly answers Wave 9 §34 — confirmed exhaustively across every repo, not assumed |
| Presentation/demo "show" capability | Twin Engine (simulate-only) | Only real "show vs describe" capability in the system, and it's isolated (§2.4/§2.5) — cannot show anything grounded in live Backend truth | — |
| Twin/spatial control | Twin Engine, per-frontend | LIVE but simulation-only, zero real device dispatch | — |
| Automation NLU (text→scene) | Backend, real LLM | LIVE, narrow | — |
| Plan Studio (image/geometry Q&A) | Office, real LLM | LIVE, narrow, explicitly separate from CRM reasoning | — |
| Development/JV/Private capability | Not independently re-verified this pass | Backend has a `developmentJv.ts` assessment capability (from prior Wave 3 work) — flagged for Slice 1 confirmation, not re-audited here | — |

---

## 17. Capability vs authority — spot checks

| Action | Capability exists? | Authority gate | Who may use it | Human approval | Side effect |
|---|---|---|---|---|---|
| Device control | Yes (Backend commandRouter) | `authorizeDeviceCommand` (Wave 5) | Resident/facility, scope-checked | Per Wave 5 risk tier | Real physical action |
| Camera discovery/snapshot | Yes (edge agent) | `validCommand()` whitelist + siteId/agentId/expiry check | Backend-issued commands only | n/a (automated, scoped) | Network probe/file capture on-site |
| Learning parameter promotion | Yes (Backend, Wave 8) | CAS + human-approver requirement | Nobody today — zero live route callers | Required by design, never exercised live | None (dormant capability) |
| CRM Lead creation from public intake | Yes (Website→Office) | API-key-gated, no additional human gate | Any public visitor via the form | No | Real CRM write |
| Oma/Osa CRM writes | Yes | `ALLOWED_CAPABILITIES`/`BLOCKED_OPERATIONAL_DOMAINS` allowlist | Public conversation, role-scoped | Not verified in depth | Real CRM writes within allowlist |
| Twin device "control" | Interface exists | `ScopePolicy.isAllowed()` | Host-supplied scope | n/a | **None — simulation only, no real side effect regardless of authority outcome** |

No capability found implies permission by itself anywhere in this system — every real ACT capability audited had a distinct authority gate, confirming Wave 5-8's governance discipline extends correctly into this Wave 9 discovery.

---

## 18. Master Agent Contract Matrix

| Agent/Surface | Role | Knowledge access | Memory access | Live-state access | Read caps | Write caps | Action caps | Authority | Human gates | Missing capabilities |
|---|---|---|---|---|---|---|---|---|---|---|
| Oyi Intelligence (Backend, resident/facility) | Home+estate conversation | None packaged | `resident_memory` (dead) | Full Wave 5-8 live truth | Extensive | Extensive | Device/scene/maintenance/visitor (26 tools) | Wave 5-8 authority modules | Per action risk tier | Voice/call, durable memory, packaged knowledge |
| Oma (Office role) | Marketing/acquisition | None wired | `lead_memories` (real) | CRM truth | CRM read | CRM write | Scheduling, limited CRM actions | Capability allowlist | Not deeply verified | Voice/call, verified-accurate technical knowledge |
| Osa (Office role) | Sales | Same as Oma | Same | Same | Same | Same | Same, different allowlist | Same mechanism, different scope | Not deeply verified | Same |
| Office internal chat | Staff CRM assistant | None wired | Server-assembled snapshot (not durable memory) | Full CRM | Full CRM | Full CRM | Full CRM ops | Staff auth/permissions | Yes, staff-gated | Voice/call |
| Executive Intelligence (Backend) | Cross-system aggregation | None | None | Read-aggregation of other modules | Extensive read | None | None | None explicit | n/a | Any real reasoning/action capability — pure aggregation today |
| Automation NLU (Backend) | Text→scene | Prompt-only | None | Reads automation domain | Automation rules | Writes one rule | None beyond that | Route auth | Implicit (user-initiated) | — |
| Plan Studio AI (Office) | Image/geometry Q&A | Task-scoped prompt only | None | Facility-provisioning tool state | Reads uploaded plan | Geometry enhancement | None real-world | Staff auth | Yes | — |
| Website Oyi Widget | Public conversation | None local (relays to Backend) | None | None local | None local | Real CRM Lead write (intake) | Voice session, handoff request | Rate-limited, server-credentialed | Handoff = human escalation | Everything is Backend's responsibility once relayed |
| Oyi-page Oma widget | Public conversation | None local (relays to Office) | Whatever Office does server-side | None local | None local | Whatever Office's public chat allows | Unknown (opaque third-party script) | Opaque | Unknown | **Full behavior unverified — a real gap, this widget's actual content/capability was never directly observed by either fork, only its existence and target** |
| Facility conversational panel | Operator chat UI | None (proxy) | Tab-session only | Via Backend proxy | Via Backend | Via Backend | Via Backend | Backend-side | Backend-side | Own knowledge/memory (has none, correctly, since it's a proxy) |
| Consumer conversational panel | Resident chat UI | None (proxy) | Tab-session only | Via Backend proxy | Via Backend | Via Backend | Via Backend | Backend-side | Backend-side | Same |
| Luna Twin Oyi panel (both frontends) | Spatial Q&A/navigation | Local static seed data only | Session-only (`lastAssetRef`) | **None — zero live Backend connection** | Local only | None | Camera/scene navigation, simulate-only | `ScopePolicy` (Twin-local, not Backend-authoritative) | None | **Live building state, real device dispatch, any bridge to the main conversational agent** |
| Edge agent | Camera bridge | Live-pulled config only | Retry queues (not memory) | Provides live evidence to Backend | Camera discovery | None | Snapshot capture, discovery | Bearer token + command whitelist | n/a | Any device command beyond the 2-item whitelist, any LLM reasoning |

---

## 19. Verdict on the three mission questions

**1. What does Oyi know?** Almost nothing in a durable, retrievable, governed sense. Backend (the actual reasoning core) has zero packaged knowledge. Office's 27-file knowledge pack is real, thoughtfully organized, but **confirmed disconnected from the live agent pipeline** — nothing reads it into a live conversation today. What agents "know" in practice is: live database state (real, governed, Wave 5-8) plus whatever is embedded directly in Backend Core's own conversation-handling code (not independently audited verbatim in this pass).

**2. What does Oyi remember?** Almost nothing. Exactly one real, live, durable memory implementation exists system-wide: Office's `lead_memories`. Backend's parallel `resident_memory` contract is fully built and fully dead. No executive/organizational memory exists — Wave 8's real outcome evidence is never read back by anything. No cross-session memory exists in any frontend.

**3. What can each Oyi agent actually do?** Real, governed, authority-gated action capability exists and is well-built where it exists (Backend's 26-tool commandRouter, Office's CRM/scheduling, the edge agent's narrow physical whitelist) — Wave 5-8's governance discipline genuinely carries through. But capability is fragmented across at least four independently-operating "brains" with no shared substrate: Backend Core, Office's role-label pipeline (itself Backend-dependent — a good pattern), the Twin engine (fully isolated, zero live connection), and two separate public-website implementations (structurally different code paths for nominally the same public "Oyi"). Voice/telephony capability is confirmed **completely absent** system-wide — not partial, not documented-only-and-secretly-live, genuinely nowhere.

## 20. Target architecture — gap assessment (descriptive only, not a build plan)

The mission's target ("ONE CORE INTELLIGENCE, ONE GOVERNED INSTITUTIONAL KNOWLEDGE SUBSTRATE, SCOPED MEMORY, SPECIALIZED AGENT ROLES, GOVERNED CAPABILITIES") is **already partially real** in exactly one place: Office's Oma/Osa/internal-chat convergence onto Backend Core, complete with a real, tested anti-regression guard against re-fragmenting it. That is the existence proof that the target architecture is achievable with this codebase's actual patterns, not a green-field aspiration.

The concrete gaps, in the brief's own terms:
- **Knowledge substrate**: does not exist yet in a connected form — the pack exists, the retrieval doesn't (§6).
- **Scoped memory**: exists for exactly one scope (Office leads); every other scope is dead or absent (§9).
- **Specialized agent roles without independent brains**: achieved for Oma/Osa; **not achieved** for the public website (two separate implementations) or for Twin/spatial intelligence (fully isolated from the shared core, twice — once per frontend).
- **Governed capabilities**: genuinely strong where they exist (Wave 5-8 authority discipline is real and consistently applied); the gap is coverage, not governance quality — voice/telephony, development/JV, and private/investment domains have no capability at all yet, so there is nothing yet to govern there.

This document makes no recommendation on sequencing or design for closing these gaps — per the mission's own explicit stop conditions, that is out of scope for Slice 0.

---

*This document is intentionally left uncommitted, per this slice's own read-only mandate. No source, prompt, knowledge file, or schema was modified in any of the eight repositories audited.*
