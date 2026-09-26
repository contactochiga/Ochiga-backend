# Wave 9 final convergence audit

Status: IN PROGRESS — not a closure certificate. Fresh source audit against durable GitHub history, 2026-09-26. Lost cloud commits were not recovered and are not implementation input. Findings below are pre-change; validation and disposition must be updated before closure.

## Baselines and preservation

Continuation evidence: see `WAVE9_CONTINUATION_VALIDATION.md` and the updated closure record. Real memory recall and a 73-entry executable capability inventory now exist. A deeper Facility trace found and removed five live local operational-intelligence fallbacks (`bfb5676`); the earlier coarse Facility assessment was insufficient. Browser and several real PostgreSQL gates now pass, but overall audit remains IN PROGRESS. No old cloud work was reconstructed.

| Repository | Authoritative branch | Remote checkpoint |
|---|---|---|
| Backend | main | 17e876d78d0baf19913845195e140c812075a2ec |
| Office | codex/office-extraction | 8f58aaef1263dfbd019d319651a95e8fb7617b80 |
| Facility | main | 60a0681968cedc0f303cf02b12c8964c879965f2 |
| Twin | main | fda2a27a31208541cb030c40ad26b01f1bc0fee0 |

Implementation uses isolated Backend/Office worktrees on `codex/wave9-final-convergence`. Original Backend .aider/opencode files, Office Supabase temporary files, and Twin artifact edits remain untouched and excluded. Office product-positioning and Facility Luna merges already exist; do not repeat them.

## Requirement ledger

| Area | Classification | Current source evidence / required closure |
|---|---|---|
| A Core authority | PARTIAL | Backend ConversationOrchestrator, canonical signal/decision/goal/learning authorities exist. Office chat delegates through oyi-core-gateway. Office Plan Studio agent calls OpenAI with an expert planning prompt independently; assess and converge this reasoning, preserving bounded image parsing. |
| B knowledge contract/retrieval | PASS | knowledgeContracts, knowledgeRetrieval and knowledgeIndex provide canonical keys, provenance, audience-before-ranking and bounded retrieval. Existing 9A–C must be retained. |
| B product/technical/commercial source authority | PARTIAL | Office contributes these domains through a Backend manifest; Backend native corpus contains five institutional items. Office positioning refers to backend:product-oyi-architecture, absent from Backend. Some mutable maturity documents are ranked technical sources. Source/classification correction required, not invention of commercial facts. |
| B Private/development/fabrication | PASS (regression pending) | Native identity items exist with investment qualification; project listings remain live state. Existing unsupported-question tests must be rerun. |
| C memory | PARTIAL | resident_memory, oyi_conversation_threads/messages, thread metadata, lead_memories, phrase memory and memory_directory exist. Directory mixes operational history with memory. Resident writer is LIVE via /ai/chat (contradicts old Slice 0 dead-code assertion); has no governed read/expiry contract and suppresses DB errors. Do not create duplicate memory storage by assumption. |
| D context assembly | PARTIAL | Core orchestrator and conversationContextLayers exist, but result-set loaders accept thread ID without actor; governance must precede all context hydration. IntelligenceContextEnvelope also accepts client role/permissions; trace consumers and forbid authority promotion. |
| E identity boundary | CONFLICT | Public Office route loads/updates CRM lead by body.lead_id or unverified email/phone. Backend uses a shared non-UUID public actor; thread storage user_id is UUID. Canonical persistence upserts caller thread IDs while several loaders read metadata by ID only. Must close cross-session/actor read/write paths, not merely filter final response. |
| F capabilities | PARTIAL | Existing executable CapabilityRegistry already models permission/scope/risk/approval/evidence/rollout. Reuse it; audit optional metadata and expose owning/read/write authority without adding competing IDs. |
| G Wave 5–8 chain | PASS structurally; validation pending | Existing canonical ingress/materialization, decision, goals, device command authority and governed learning remain Core-owned. Rule-based prediction is not a second model. Preserve semantics. |
| H Office | PARTIAL | Main/public/internal conversation delegates. Plan Studio Q&A is independent planning inference. Geometry extraction and STT are bounded adapters. Retired LeadAgentRuntime is guarded out. |
| I Facility/Twin | PASS authority distinction; PRODUCTION-RISK validation | Facility main conversation delegates to Core. Twin is explicit deterministic simulation/navigation, not live device authority or LLM. Do not rename simulation as competing AI. Standalone Twin build needs fresh verification (prior PNG typing issue); remote pinned package portability must remain. |
| J migrations | PASS history membership; PARTIAL schema equivalence | Live Backend history contains all 115 tracked versions, including ALL five LOCAL_TEST files. Retain them. Office schema uses a separate application path. See migration ledger; no production mutation authorized. |
| K Office privacy/security | CONFLICT | Public chat CRM matching lacks proof of ownership; raw lead/conversation response risks disclosure. Plan Studio project GET routes explicitly bypass auth while returning stored project/image data. Staff identity originates authContext, bridge authenticated by service secret; check all related routes and tests. |

## Memory and fact ownership inventory

- Core conversation threads/messages: durable conversation context, actor/surface scope, NOT current operational state.
- Thread metadata: result sets, person context, pending proposals/goals/communications; some have TTL, some only owner checks. Must authorize before hydration.
- resident_memory: private user/home/estate interaction context; /ai/chat records prompt/reply. Existing JSON can carry provenance/expiry; no new store justified yet.
- Office lead_memories: CRM-owned retained relationship context; store methods exist but current delegated chat returns lead_memory:null. Live writer/read reachability still under audit.
- ochiga_memory_directory: descriptive directory, not source truth or permission grant.
- Phrase memory: governed language interpretation hints, not personal memory.
- Camera/device history, canonical awareness, outcomes and learning parameters: operational evidence/learning authorities; do not copy into factual memory.
- Twin lastAssetRef/lastSpaceRef: transient navigation context only.

## Provider-call classification

Backend utils/ai.ts is a bounded automation parser; its automations route currently has no app import found, whereas /ai/chat is mounted and delegates Core. communicationRuntime/replyClassifier is bounded inbound classification; communicationsMediaAdapters performs sensory STT/TTS/image/document extraction. Language-teacher provider classes require inspection of actual execution rather than assuming labels call providers. Office server has two Responses call sites: geometry extraction and Plan Studio question answering; only the latter is a reasoning-convergence candidate. No Facility/Twin model call found in the prior scan; repeat exhaustive final scan required.

## Implementation order derived from findings

1. Source-authority correction and tests using existing knowledge contract.
2. Thread/session authorization and Office public CRM ownership closure before memory integration.
3. Governed memory/context projection over existing stores with explicit provenance, retention and access boundaries.
4. Extend existing capability metadata/guards only where incomplete; converge Plan Studio reasoning through Core.
5. Security, migration/schema and cross-repository build/regression proof; publish development PRs, never silently merge failing checks.

No closure declaration is valid while these findings or required tests remain unresolved. No Wave 10 work.

## Validated increments

First increment adds the missing `backend:product-oyi-architecture` item to the existing governed corpus (six audience roles, qualified claims, source references; no new retrieval authority). Fixes the three existing Wave 9 smoke scripts to resolve their own checkout rather than silently loading the original Mac checkout's dist. Typecheck, build, new product-authority test, and existing knowledge suites pass: 19 + 21 + 11 checks. This does not close memory, identity or Office findings. Fresh fetch/ls-remote confirms all four baseline SHAs above.

Dependency installation reports 15 existing Backend vulnerabilities (8 moderate, 6 high, 1 critical); no blind dependency upgrades performed. Dependency risk needs triage before production closure.

Second increment: Core orchestrator and both compatibility runtime entry points now authorize an existing thread's actor, surface, estate and home before context/proposal hydration. Missing/unrecognized client thread IDs cannot claim future ownership; DB errors fail closed. Public text and communications use deterministic session-scoped UUID identities instead of the shared non-UUID guest. Public session IDs must be established by the authenticated bridge; Office adds signed continuity separately. No auth.users identity is created or implied. Production catalog confirms conversation user_id is UUID without an auth-user FK; RLS is authenticated-owner SELECT only. No migration needed.

Validation: typecheck/build, conversation ownership adversarial suite, corporate public integration/contract, canonical runtime structure, security adversarial, conversation foundation, Consumer context, Facility spatial, Wave 7 decision (19 checks), Wave 8 learning (21 checks) pass. This is scoped conversation-boundary proof, not proof every context helper is independently safe for arbitrary future callers.

Production memory finding: resident_memory has owner ALL RLS (authenticated users can contribute their own rows), with a nullable home key in its unique index. Any future memory adapter must treat stored content as untrusted actor context, never server-authoritative evidence/permissions, and must avoid null-home upsert duplication. This is an implementation requirement, not a claim memory closure is already complete.

Source reclassification: Office's business-model-and-current-maturity.md mixes inferred revenue models and undated runtime claims; it is now UNVERIFIED_REFERENCE, internal commercial, human confirmation required, rather than TECHNICAL_SOURCE. The pitch-deck narrative was already MARKETING_REFERENCE and remains so. No commercial facts or prices were invented, and no source file was deleted. The initial table above records pre-change findings.

## Current review disposition (2026-09-26)

Backend draft PR #90 and Office draft PR #85 contain the validated increments; neither authoritative branch is merged. Twin's build-only compatibility commit is on `codex/wave9-build-verification`, not main. Facility main remains unchanged and its exact remote Twin dependency is preserved.

Plan Studio independent answer generation is replaced by a governed Backend capability; bounded geometry extraction stays in Office. See `WAVE9_PLAN_STUDIO_CORE_DELEGATION.md`. Office requires an actual capability-result acknowledgement and fails closed with an older Backend. No deployment or migration accompanies this increment.

The runtime presentation-context normalizer now takes role/permissions exclusively from server actor context. Resident memory tests additionally prove a resolved Supabase write `{error}` fails. Memory admission is implemented, but no downstream consumer currently explicitly consumes `governed_context`; this is **not** full memory adoption. Conversation/result-set, knowledge and relationship adapters still need a complete governed-assembly adoption audit.

Office `getLeadMemory` has one live authenticated `view_dashboard` route; the retained upsert methods have no live caller found in `src`. This is legacy CRM context, not an active second reasoning engine. Its retention and actor/relationship authorization still need a final inventory before closure.

Backend full release validation initially exposed a pre-existing canonical-truth test that expected legacy camera `health:offline` to establish truth. Only the test was corrected to supply canonical `current_state`, retain physical-disconnection qualification and reject legacy-only evidence. Release validation then stopped at `device-schema-release-smoke` for missing Supabase credentials. No credential was substituted and this check is not PASS.

Current validation and remaining gates are recorded in `WAVE9_FINAL_CLOSURE.md`. That document is deliberately an incomplete checkpoint, not a release certificate.
