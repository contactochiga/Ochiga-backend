# IQ-10D frozen evidence-to-answer development contract

Starting runtime: `993bc507673e6c7665e6e5332a3202e4daf57743`.
This contract precedes runtime edits. It is development evidence, not independent
intelligence certification. No sealed IQ-9B utterances are used.

## Audited boundaries

| Family | Existing owner | Demonstrated risk / requirement |
|---|---|---|
| Office supplied record lists | OfficeCorporateCapabilityModules → table/record_list → envelopeMappers | Keep ID, owner, status, age and supplied fields; total open is not total stale/attention. No Backend bypass. |
| Maintenance | maintenanceEvidence → maintenanceAnswerRows | Loader has category, assignment, timestamps and scope; answer rows discard these. A request/assignment is not work commencement. |
| Visitors | visitorEvidence → visitorAnswerRows | Expiry, identity and scope are discarded; permission must remain distinct from arrival. No access credentials in envelope. |
| Wallet balance/history | walletEvidence → ReadCapabilityModules / walletAnswerRows | Null converted to zero; history defaults currency. Preserve source denomination/as-of; never derive balance from history. |
| Device/current state | device inventory → table rows | Registry/availability is not power or physical effect. No reinterpretation of stale state. |
| Cameras | cameraReads → read module | Registry location selected but lost; no structured records in answer despite available camera identities. Unknown video does not erase registry evidence. |
| Utilities | existing spending/purchase/usage contracts | Money is not consumption; disabled usage remains unsupported. No new capability. |
| Public supplied opportunities | IQ-10C entities → heldFactsEnvelope/projectHeld | Preserve selected entity, constraints and caller-unverified provenance; withdrawal and handoff truth stay specialized. |
| Governed multi-source | IQ-3B planner and R3 multipart | Keep source-local failure/partiality. No new fan-out, authority or judgment. |
| Actions/communications | existing actionTruth and public handoff | Projector must not capture specialized action-result/confirmation ownership. |

## Invariants

1. Mapping moves only structured authorized facts; no extraction from prose, no
   new query, no inferred value, confidence, timestamp or authority.
2. Record identity, type, scope, source reference, truth state and freshness survive
   mapping when present. IDs stay structural, not user-facing filler. Only explicit
   safe material fields are projected; credentials/provider payloads never pass.
3. AnswerTarget carries requested record fields. A requested field is shown for the
   selected entity or explicitly unavailable. Multiple requested fields are not
   arbitrarily cut off after three. Missing targets cannot borrow another record.
4. LIST/COUNT distinguish returned population, known total, filtering, boundedness
   and unavailable sources. An empty filtered page is not proof of global zero.
   Unknown status does not prove active/open. Partiality is visible in primary text.
5. Financial quantities retain source, currency and as-of; missing amount/currency
   is limited, never zero/default currency. Like-unit recorded comparisons are
   allowed; strategic judgment and unlike-unit comparison are not fabricated.
6. Visitor permission, maintenance status, device availability, physical verification
   and communication receipt remain distinct. Preserve existing safety denials.
7. Public recall retains entity-bound constraints and supplied-fact provenance;
   no cross-entity merge or Office-private evidence.
8. Existing context, persistence, trace and action ownership do not change.

## Frozen development scenarios and gate

`scripts/iq10d-evidence-contracts.mjs` is the pre-implementation executable set:
new synthetic Orchid/Cedar records, partial populations, missing financial fields,
visitor expiry, identity/scope preservation, selective field answers and controls.
All its assertions must pass unchanged. Complement it with canonical four-worker
journeys, IQ-10C/10B/10A, historical regression chain and frozen 280 comparison.
No P0, no defensible original frozen-PASS regression, no hidden workflow exclusions.
Changed answers require individual review; limitation != implemented capability.
Paraphrases in this development set are same-maintainer, not blinded authorship.
Additional discoveries require explicit tests, not relaxed frozen assertions.
