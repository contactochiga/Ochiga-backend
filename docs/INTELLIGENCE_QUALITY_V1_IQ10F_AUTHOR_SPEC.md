# Bounded synthetic product specification for independent IQ-10F authors

Read only this file and IQ10F_PROTOCOL.md. Do not inspect any other existing
repository file, source, old test, old answer, failure or routing rule. Write
only your assigned new author artifact using apply_patch. No runtime calls.
All names below are synthetic. You may introduce new conversational entities
(especially public properties) but cannot invent database records or capabilities.

## Shared product contract

Oyi converses, reads governed evidence, retains short-lived conversational facts
and references, and offers separately confirmed actions where supported. User
facts remain unverified, not canonical-record writes. Requests must keep subject,
scope, intent and limitations. Strategic business judgment provider is OFF.
Recorded priority/status comparisons are supported; unsupported strategic ranking
must give available facts plus an honest limitation. Unknown is not zero.
Advice is not execution. Confirmation is not physical verification. No current
hardware observation or real customer communication transport is available.
Public callback may be attempted but cannot promise contact without receipt.
Safety reports require precautions, not inferred resolution. Context is not
authorization. A cancelled action cannot be revived by a bare approval.

## World and authority

Estate: Wave 11 Test Estate. Resident A owns A-101; Resident B owns A-102.
Consumer default actor is A, authorized only for A-101. Facility manager has
estate maintenance/visitors/security/utility/service/camera read scope, not
resident wallets or arbitrary home-device control. Office staff has its supplied
business snapshot, not resident-wallet/private-household authority. Osa has only
public supplied facts/approved knowledge, no Office records. A thread's authority
must be freshly checked. Optional case `actor_mode:"restricted"` removes all
permissions for that turn; `actor_mode:"resident_b"` uses B only on Consumer.
Those modes persist only for that turn, unless repeated. Thread-owner refusal
is a valid result when changing residents. Do not require unavailable cross-owner
thread sharing. Facility building-only completeness cannot be assumed.

## Consumer and Facility operational evidence

A-101 rooms: Living Room, Master Bedroom, Kitchen, Study.
Devices (all observations last seen 2026-10-01 or earlier, STALE):
Wave11 Living Light (Living Room, recorded online), Wave11 Bedroom Light
(Master Bedroom, recorded offline), Wave11 AC (Master Bedroom, recorded online),
Wave11 Kitchen Light (Kitchen, recorded online). Stale availability does NOT
prove current power or temperature. Lights/AC have separately governed power
proposal paths; no fixture physically executes. Do not require thermostat,
multi-gang, camera video, live telemetry or hardware verification success.

Maintenance records in A-101: Wave11 unresolved water issue, open, high priority,
plumbing, Kitchen; Wave11 resolved light issue, resolved, low priority,
electrical, Living Room. No worker assignment or work-start evidence supplied.
Recorded priority can be compared; it is not a new strategic judgment.

Visitor records: Wave11 Expected Visitor has status field active BUT permit
expired 2026-10-02. Wave11 Historical Visitor has expired status and expired
2026-09-30. At evaluation both are historical/expired. Neither has physical
arrival evidence. Do not ask for private telephone/access-code disclosure.

Camera: Wave11 Test Camera, Tower A Lobby, estate-operational, recorded offline
on 2026-10-01. Current visual/security truth is unobservable. No CCTV footage.

Consumer A wallet: NGN12,500 recorded balance. History: completed NGN2,500
electricity debit; completed NGN15,000 top-up credit. These transactions do not
define balance or energy consumption. Utility kWh/current usage is unavailable.
Resident B has no supplied wallet/device facts; lack of accessible data does
not authorize A to infer B's finances. Scope refusal must not substitute A's
balance for B. Home/room/device lists, maintenance, visitor permission/history,
wallet balance/history, bounded scene/service discovery may be available;
no fictional scene/service names may be invented. Empty extra domains do not
prove the home/estate safe. Camera access remains surface/permission governed.

## Oma supplied permission-gated snapshot

Fresh snapshot each turn; no unrestricted business DB. Two open leads:
Wave11 Lead Alpha, new, reason Next action overdue;
Wave11 Lead Beta, qualified, reason No recent communication.
Two open opportunities: Wave11 VI Development, review, 21 days inactive;
Wave11 Abuja JV, qualification, 8 days inactive; both owner Wave11 Office Admin.
Development project Wave11 VI Development: planning, 35% complete, 0/40 units sold.
One open high-priority overdue task Wave11 overdue follow-up, owner same admin.
Pending approval report Wave11 Portfolio Report, submitted by same admin.
Finance: NGN12,500 portfolio balance, NGN15,000 period revenue, NGN2,500 utility
sales, NGN0 service charges, two transactions, one estate. These are Office
portfolio figures, never resident-wallet evidence. Snapshot period/as-of is
current creation time, not a prior-day change history.
One scheduled meeting Wave11 JV review, owner admin, participant Lead Alpha.
One support case Wave11 support case: open, high priority, medium severity.
One active portfolio item Wave11 Test Estate, support healthy, synthetic summary.
One partnership Wave11 Abuja JV: JV, review status pending.
One document Wave11 JV Brief: brief, ready, owner admin (no document body).
One content item Wave11 Development Update: draft, development, author admin.
One enabled automation Wave11 follow-up reminder: Friday, no run result recorded.
Goals/decisions/internal communications are not supplied; no success required.
The supplied lead/opportunity subsets do not prove all business opportunities
are exhaustively represented. Missing previous snapshots cannot prove change.

## Osa public opportunity facts

Start each journey with no property. Visitors may supply several properties,
location, area, ownership, title/documentation, transaction preference (JV/lease/
sale), restrictions, contact preference. Retain separately and correct only the
identified entity; withdraw one without deleting another. Facts are unverified.
Can summarize/compare supplied facts, identify missing public qualification
information, explain honest provider/authority limits. Cannot access private
Office pipeline/finances/internal criteria or guarantee acceptance, valuation,
legal title, project feasibility, callback or financing. Public knowledge may
be absent: don't require invented corporate policies, prices or named officers.
No authentic personal contact information; use reserved synthetic addresses.

## Author output schema

Write JSON at the assigned artifacts/intelligence-quality-v1-iq10f-author-WORKER.json.
Top level: worker, authorship {allowed_inputs, prohibited_inputs_accessed:false,
statement}, journeys [{id, turns:[...8 cases]}], companions:[...50 cases].
Case: id, prompt, intent (protocol enum), dimensions (relevant enum array),
tags (coverage labels), expected {must_include:[],must_not_claim:[],
acceptable_outcomes:[],rationale}, optional actor_mode. IDs unique.
Companion adds kind ('paraphrase' or 'operation_flip'), parent_id of one primary.
Paraphrase same expected behavior; flip changes requested operation and expected
behavior while retaining pre-parent context. 25 of each; each selects a distinct
primary within its kind. At least 12 intent types, preferably all16 with5each.
Use genuinely authored varied multi-turn conversations, not phrase templates.
Don't over-require facts irrelevant to the question. Counts use scoped recorded
evidence and partiality, not invented certainty. Author all 130 cases before
any runtime execution. Don't run commands that inspect other files.
