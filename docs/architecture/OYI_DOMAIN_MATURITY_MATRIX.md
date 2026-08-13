# Oyi Domain Maturity Matrix

Status: Phase C capability/workflow rollout matrix.

Phase B separates vocabulary from production ownership. `enabled` means resolver, authority, evidence requirements, evidence loading, read handler, structured result status and presentation policy are all present and tested. `implemented`, `shadow` and `declared` capabilities are not advertised to end users as available.

Phase B correction: enabled read capabilities also persist through canonical Oyi conversation History. Wallet transaction evidence now follows the authorised home wallet relationship path. Utility active/usage/balance/meter reads remain below enabled and must not be answered by the utility spending handler.

Phase B final correction: resolved-but-not-enabled capabilities return safe canonical fallback responses instead of generic runtime failure wording. Capability advertising presentation no longer emits unrelated Home update artifacts, and source metadata is deduplicated into useful resident-facing labels.

Phase C adds durable conversation workflow/action persistence and device-first explicit-confirmation action orchestration. Device execution still uses the existing command pipeline; no other sensitive action domains are migrated in this phase.

Phase C correction: device action target resolution now uses the canonical named-device resolver before clarification, extracts channel/state/device from complete commands, and evaluates pending workflow clarification before ordinary read capability routing.

Phase C runtime correction: device action preparation now emits staged production traces, reports workflow/action persistence failures as safe structured outcomes, and no longer depends on a hard workflow/action foreign-key ordering against conversation thread persistence.

Phase C final multi-gang correction: independently controllable multi-channel devices cannot reach confirmation without an explicit valid channel. Channel candidates are loaded from device metadata/capabilities, persisted with the workflow, and confirmation binds the canonical channel code plus requested state.

Phase C reload correction: pending channel clarification and pending confirmation survive Consumer reload through canonical thread restoration. Thread APIs expose safe `active_workflow` metadata, and continuation is accepted only for the same authenticated actor/surface/scope/thread workflow, never by broad actor/home guessing.

| Domain | Direct Evidence | Read | Detail | History | Explain | Compare | Recommend | Draft | Clarification | Approval | Execution | Verification | Home Contributor | Room Contributor | Prediction | Anomaly | Outcome | Legacy Dependency | Production Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| devices | Mature | Enabled read capabilities | Yes | Enabled activity/failures | Enabled diagnosis | Partial | Partial | Durable power/channel draft | Durable explicit confirmation | Durable approval | Existing command path via durable action | Existing command verification | Pending formal contributor | Pending room contributor | Partial | Partial | Partial | Low | Phase C device-first durable action path |
| rooms | Partial | Partial | Partial | Partial | Partial | No | Partial | No | Yes | No | No | No | Pending | Pending | No | No | No | Medium | Active with gaps |
| home | Partial | Partial | Partial | Partial | Partial | No | Partial | No | No | No | No | No | Pending aggregator | N/A | No | Partial | No | Medium | Active with gaps |
| maintenance | Context-backed module | Implemented, not enabled | Partial | Partial | Partial | No | Partial | Draft path pending | Yes | Pending | Pending | Pending | Pending | Pending | No | Partial | No | Medium | Legacy fallback measured |
| visitors | Context-backed module | Implemented, not enabled | Partial | Partial | Partial | No | Partial | Draft path pending | Yes | Pending | Pending | Pending | Pending | No | No | Partial | No | Medium | Legacy fallback measured |
| access | Partial | Partial | Partial | Partial | Partial | No | No | Pending | Yes | Pending | Sensitive | Pending | No | No | No | Partial | No | Medium | Restricted |
| wallet | Partial | Enabled transaction read | Partial | Enabled transactions | Partial | Partial | No | Financial execution disabled | Yes | Required | Disabled | Pending | Pending | No | No | Partial | No | Medium | Phase B enabled for consumer transaction reads |
| transactions | Partial | Yes | Partial | Yes | Partial | Partial | No | No | No | No | No | No | Pending | No | No | Partial | No | Medium | Active |
| utilities | Wallet-backed spending evidence | Enabled spending read; active/usage/balance/meter below enabled | Partial | Partial | Partial | Partial | Partial | Financial execution disabled | Yes | Required | Disabled | Pending | Pending | Pending | Pending | Pending | No | Medium | Phase B enabled for consumer spending reads only |
| services | Module exists | Implemented, not enabled | Partial | Partial | Partial | No | Partial | Pending | Yes | Pending | Pending | Pending | Pending | No | No | No | No | Medium | Legacy fallback measured |
| security | Module exists | Implemented, not enabled | Partial | Partial | Partial | No | Partial | Pending | Yes | Required | Restricted | Pending | Pending | Pending | No | Yes | No | Medium | Legacy fallback measured |
| community | Module exists | Implemented, not enabled | Partial | Partial | Partial | No | No | Draft pending | Yes | Required for send | Pending | Pending | Pending | No | No | Partial | No | Medium | Legacy fallback measured |
| messages | Partial | Implemented, not enabled | Partial | Partial | Partial | No | No | Draft pending | Yes | Required for send | Pending | Pending | Pending | No | No | Partial | No | Medium | Legacy fallback measured |
| scenes | Module exists | Implemented, not enabled | Partial | Partial | Partial | No | Partial | Pending compiler | Yes | Required | Existing route path | Partial | Pending | Pending | No | Partial | No | Medium | Legacy fallback measured |
| automations | Module exists | Implemented, not enabled | Partial | Partial | Partial | No | Partial | Pending compiler | Yes | Required | Existing route path | Partial | Pending | Pending | No | Partial | No | Medium | Legacy fallback measured |
| cameras | Partial | Partial | Partial | Partial | Partial | No | Partial | No | Yes | Secure handoff | Restricted | Pending | Pending | Pending | No | Partial | No | Medium | Restricted |
| notifications | Partial | Yes | Partial | Partial | Partial | No | No | No | No | No | Existing delivery policy | Partial | Pending | No | No | Partial | No | Medium | Active |
| incidents | Partial | Yes | Partial | Partial | Partial | No | Partial | Pending | Yes | Pending | Pending | Pending | Pending | Pending | No | Yes | No | Medium | Active with gaps |
| reports | Module exists | Shadow | Partial | Yes | Partial | Yes | No | No | Yes | No | No | No | Consumes contributors later | Consumes contributors later | No | Partial | No | Medium | Shadow, not advertised |

This matrix is intentionally conservative. A domain should move to production-complete only after direct evidence, authority, workflow/action, verification and tests are proven.
