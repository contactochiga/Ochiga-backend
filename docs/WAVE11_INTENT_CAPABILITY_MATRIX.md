# Wave 11 intent → capability matrix

## Contract

The canonical parser emits a semantic frame. It does **not** emit a registry
key. Capability resolution selects a registered module by its `supports(frame)`
predicate and then applies rollout, surface, scope, permission, evidence and
action authority.

`domain.operation` is therefore a descriptive turn label only; it is not a
capability identifier. For example, `home/summarize` is resolved to
`home.summary.read`, not a fictional `home.summarize` module.

## Resolution outcomes

| Outcome | Meaning | Terminal behaviour |
| --- | --- | --- |
| `matched` | One enabled, eligible capability matched the frame. | Governed capability response. |
| `declared_disabled` | A registered capability describes the request but is not enabled. | Honest unavailable/unsupported response. |
| `permission_restricted` | A matching capability exists but actor permissions are insufficient. | Persisted restriction response. |
| `scope_restricted` | A matching capability exists but verified scope is insufficient. | Persisted restriction response. |
| `surface_restricted` | A matching capability does not serve the current surface. | Persisted restriction or surface fallback. |
| `no_match` | No capability predicate claims the semantic frame. | Persisted canonical unsupported response. |

Workflow restoration, confirmation, cancellation and result-set follow-up are
evaluated before ordinary capability selection; they are governed continuation
states, not missing capabilities.

## Executable coverage

`scripts/wave11-intent-capability-contract-smoke.mjs` exercises 34 distinct
parser classes against the real registered capability predicates without DB,
provider or action execution. It covers Home/Room, Device, Wallet, Utilities,
Maintenance, Visitors, Security, Community, Automations, Reports, Office CRM,
Office operations and public-corporate knowledge.

The intentionally non-enabled classes currently verified are:

| Semantic class | Registered capability | Outcome | Reason |
| --- | --- | --- | --- |
| utilities / `utilities.usage` | `utilities.usage.read` | `declared_disabled` | No trustworthy consumption series is loaded. |
| reports / list | `reports.period_summary.read` | `declared_disabled` | Report evidence is not yet enabled. |

## Corrected Home family

The broad home-summary predicate now covers natural wording including “What’s
happening at home?” and resolves it to `home.summary.read`. Attention and
activity wording continue to select `home.attention.read` and
`home.activity.read`; this preserves distinct evidence and result-set meaning.

The contract run also exposed two parser boundary defects fixed in this slice:
plural `rooms` and plural `visitors` were not classified because the prior
word-boundary expressions recognised only singular forms.

## Persistence and telemetry invariant

Every ordinary canonical-orchestrator response now takes exactly one
persistence path: a capability-owned response uses the established capability
lifecycle; a terminal response uses the same
`persistCanonicalConversationTurn()` writer through the terminal lifecycle.
The latter includes canonical unsupported/no-match and business-surface
fallback. A failed writer remains visible as `persistence_saved: false`; the
runtime may not silently claim continuity.

New telemetry exposes `oyi_conversation_terminal_outcome_total` and the
`canonical_terminal_response` trace stage. Existing legacy-named fields remain
compatibility metadata only; they no longer describe canonical terminal turns
as a legacy-general-chat answer.

## Deliberate non-coverage

Some parser-recognised domains have no enabled evidence module. They must end
in a classified, persisted terminal response rather than an invented answer or
a fabricated capability key. The behavioural harness records these as
capability-selection failures only when product behaviour expects an enabled
worker for the tested surface.
