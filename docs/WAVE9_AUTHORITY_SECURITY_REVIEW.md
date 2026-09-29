# Wave 9 authority and dependency continuation

## Authority paths traced

| Path | Classification / boundary |
|---|---|
| Backend oyiRoutes, aiRoutes, officeExport, communicationsOyiTurnService → ConversationOrchestrator | Canonical Core entry; governed context runs before capability dispatch |
| Core LegacyConversationAdapter → canonicalConversationRuntime → runOyiUnifiedChat | Backend compatibility subpath, not another host brain; ownership checked, but remaining context-adapter/persona adoption needs completion |
| Core knowledgeRetrieval/contracts/index | Canonical knowledge authority; Office contributes authenticated source material |
| Core governedContextAssembly/residentMemoryContext/MemoryRecallCapability | Canonical scoped resident-context admission and explicit historical recall; not a substitute for current operational evidence |
| Core capability registry, DecisionStore, GoalRuntime, canonical signal/materialization, outcome/learning services | Canonical intelligence/action-governance chain; registered 73-entry inventory and Wave 5–9 regression evidence retained |
| Backend communicationsMediaAdapters | Bounded transcription/synthesis/image/document sensory provider adapter; not a second orchestration authority |
| Backend communicationRuntime/replyClassifier | Bounded inbound-reply classification; does not independently authorize execution |
| Backend utils/ai.ts | Legacy structured automation parser under the unmounted automation route; not a live replacement Core entry |
| Backend language-teacher/providerRegistry | External named adapters currently return null; local phrase interpretation, not active parallel model calls |
| Backend PlanStudioCapability | Core-governed advisory provider call; Office delegates and requires capability acknowledgement |
| Office OpenAIResponsesClient and server enhancePlanStudioGeometry | Provider wrapper and bounded image-to-geometry specialist; not the removed plan reasoning path |
| Office voice transcription | Sensory adapter for subsequent Core conversation, not intent/action authority |
| Office lead_memories file/Supabase stores | CRM retained context, not canonical Oyi factual memory. GET route requires view_dashboard; full relationship/retention/persona review remains open |
| Facility five live runtime loaders | Core-only outputs or rejection; no local fallback answer on outage |
| Facility retained deriveRealtime*/lib build* helpers | Legacy deterministic intelligence helpers with no live call found in the repeated app/components/services source search; do not reactivate as fallback |
| Facility attention/context normalization | Host domain contribution/presentation; must not substitute for Core accepted intelligence |
| Twin lunaIntentParser/lunaExplain/lunaSimulationProvider, spatial engine | Deterministic navigation, local simulation and explanatory rendering; no provider invocation found in source sweep. Not misclassified as a competing LLM brain |

This is a traced path inventory, not proof that every context/persona adapter meets all closure criteria. Outstanding: unify/document remaining legacy context admission semantics, complete cross-persona tests and CRM retention/relationship access disposition. Do not declare all memory contracts adopted merely because the type exists.

## Dependency disposition

Backend audit still lists six packages: AWS SDK v2/uuid (moderate), ip-cidr (moderate), ip-address/ip/node-ssdp (high).

- AWS region is deployment configuration (`s3Service.ts`), not a request-controlled region in the traced path. Migration to SDK v3 is not a drop-in version bump; configuration validation remains an option requiring tests.
- AWS SDK uses uuid.v4, not advisory-affected caller-buffer v3/v5/v6 methods. Installed UUID dependency remains reported; no universal safety claim.
- node-ssdp uses ip.address(), not the advisory-affected isPublic classification. SSDP network discovery is still security-sensitive; this is limited advisory-path analysis.
- ip-cidr imports old ip-address; cidrToIps has no live source caller found. HTML rendering methods are not used. Leading-zero input and unbounded enumeration remain reasons not to activate this helper without hardening. Do not silently waive the package advisory.

Facility: critical tar comes through development-only Capacitor CLI 6.2.2, which calls extractTemplate on shipped native template archives. No live web-upload extraction caller found. A scoped tar 7.5.22 override was attempted and **rejected**: real Capacitor extraction fails because its default-import shape is incompatible. The override was removed; all five bundled templates pass with restored tar 6.2.1. A maintained compatible CLI/patch strategy and native validation are required before claiming this critical finding remediated. The compatibility test is intentionally NOT a security certification.

Next's PostCSS and sharp chains are separate: PostCSS build-time CSS/source-map handling and sharp image decoding. Review actual input trust and deployment versions; no forced Next/Capacitor major upgrade or silent native decoder replacement. See Facility security record for the tested PostCSS correction.

**Security and final authority closure remain open.** Findings describe reachability, not approval to deploy vulnerable versions.
