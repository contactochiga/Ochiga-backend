# IQ-11B effective authority and hazard continuity contract

Frozen before runtime changes at starting HEAD `a06004b53c875228fefc9a2424cf5a6ffe5d6439`, branch `codex/intelligence-quality-v1`, origin `contactochiga/Ochiga-backend`. This slice does not certify overall intelligence or authorize trace remediation, production changes or Initiative.

## Authority policy

The existing canonical calculation is the union of role-derived permissions, explicit `permissions` and `permission_scopes`, including CapabilityService's existing aliases. Empty explicit arrays do not revoke role grants. No explicit negative permission/revocation field is supported by this calculation. IQ-11B will not introduce one or change role policy. Authentication must supply the current actor; conversation context is never authority.

Tests of effective denial will use the same synthetic identity with a canonical role lacking the requested grant (guest, with no wallet/device/support grants), and assert `canUse` actually denies before testing fresh reads or cached continuation. A guest's visitor permission is not a wallet/device grant. A guest with an explicit required grant is a positive control. This resolves the IQ-10F fixture/specification discrepancy prospectively; its sealed grades and artifacts remain unchanged.

## Scope and attribution

Requested subject/population must survive routing and continuity independently of readable evidence. Consumer reads remain in the authenticated home; foreign subjects must not be answered with own-home data. Office/private/public boundaries remain unchanged. A true denial cannot be replaced by an unrelated authorized fallback.

Facility estate authority can select a uniquely matched home from the server-resolved operating context in that estate; this narrows scope and never grants a capability. Absent/ambiguous/unverified home references must clarify or limit, not return a broad collection as home truth. Every selected source still passes canonical canUse and scope checks. The response must retain actual source scope; a home-specific answer cannot present estate-only evidence as complete home evidence. No label guessing, arbitrary home choice or unscoped lookup is allowed.

Explicit requests not to read or republish private evidence must not revive cached assessments. The existing disclosure/semantic contracts own that restriction; no new permission system is created.

## Hazard continuity

Server-derived hazard context comes from the authorized canonical conversation history, not client metadata. A caller's report is unverified but material. Topic switching, administrative ticket closure, assessment expiry or a caller saying the issue ended do not verify physical resolution.

Read-only status, assessment, comparison, explanation, draft, recap and reference paths must preserve this distinction. Historical administrative records may be shown as records, but cannot negate the report or rank it as no current concern. Judgment must receive the safety constraint before conclusion generation, and response projection must retain it before persistence. Where target linkage is uncertain, state that the report is unresolved without attributing it to an unrelated record. No new conversation store or live model is added.

Existing hazard/action admission, protective-off confirmation, terminal cancellation, target resolution and physical verification requirements remain unchanged. Hazard context grants no authority. Cancellation has precedence; approval is not dispatch, provider acceptance is not physical verification.

## Frozen development controls and gates

The accompanying `artifacts/intelligence-quality-v1-iq11b-development-contract.json` freezes new synthetic control families before implementation. These are development controls authored by the implementing maintainer, not a blinded independent certification. Existing IQ-10F utterances are not executed or used as new phrase rules.

All new safety/authority assertions and positive controls must pass; zero observed P0 and zero physical-executor attempts. Supported explicit revocation is not applicable, not a fabricated passing feature. Confirm actual effective permissions in tests rather than relying on actor array appearance. Preserve all defensible original frozen-PASS answers; review every changed one individually. Run the full requested regression chain; report historical workflow failures without hiding them. No expectation weakening after implementation. Any new ambiguity in these gates is documented, not silently waived.

Measure new live-turn latency against a pre-change control run using the same new scenarios, separately from fixture overhead. Preserve canonical save/trace contracts without implementing IQ-11C. Certification is blocked if required evidence cannot be captured reliably.
