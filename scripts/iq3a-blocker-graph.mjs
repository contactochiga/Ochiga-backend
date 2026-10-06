// IQ-3A benchmark-required blocker graph.
// Pure diagnostic: reads frozen artifacts only; executes no collector and no query.
// It records the mandatory/optional classification BEFORE source hardening so
// later certification cannot silently reinterpret what the benchmark requires.
// Mandatory = the assessment cannot responsibly be made without the evidence
// class (judged from the FROZEN envelope's must_notice/acceptable conclusions and
// the turn's own request), not from the size of the capability registry.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const startingHead = '00daff730bb4bf188db4fa340779e6d591d21994';
// Starting-HEAD artifacts are read from git so regeneration after hardening cannot change the frozen graph.
const atHead = p => JSON.parse(execFileSync('git', ['show', `${startingHead}:${p}`], {maxBuffer: 1e9, encoding: 'utf8'}));
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const cert = atHead('artifacts/intelligence-quality-v1-evidence-certification.json');
const pre = read('artifacts/intelligence-quality-v1-iq3-preimplementation-audit.json');
const inv = atHead('artifacts/intelligence-quality-v1-evidence-source-inventory.json');
const families = Object.fromEntries(inv.records.map(r => [r.capability_key, r.collector_family || (r.planner_eligible ? 'OPERATIONAL_SCOPE_OR_OFFICE_SNAPSHOT' : null)]));
const byId = Object.fromEntries(pre.records.map(r => [r.id, r]));
const blocked = cert.readiness.filter(r => r.status === 'SOURCE_CONTRACT_BLOCKED');
assert.equal(blocked.length, 69, 'graph is defined over exactly the 69 blocked rows at starting HEAD');
// Pre-hardening certification state is frozen from the starting-HEAD inventory.
const preCertified = new Set(inv.records.filter(r => r.planner_eligible).map(r => r.capability_key));

// --- Evidence class catalogue: class -> surface x scope -> source keys that can
// satisfy it. An empty source list means no implemented/enabled safe source.
const CLASSES = {
  crm: {office_permissioned_snapshot: ['crm.leads.read', 'crm.opportunities.read']},
  office_financial: {office_permissioned_snapshot: ['financial.summary.read']},
  office_documents: {office_permissioned_snapshot: ['office_documents.query.read']},
  corporate_opportunity: {public_public_corporate: ['corporate.opportunity.read']},
  corporate_partnerships: {public_public_corporate: ['corporate.partnerships.read']},
  corporate_development: {public_public_corporate: ['corporate.development.read']},
  maintenance: {consumer_home: ['maintenance.requests.read'], facility_estate: ['maintenance.requests.read']},
  security: {consumer_home: ['security.incidents.read'], facility_estate: ['security.incidents.read']},
  visitors: {consumer_home: ['visitors.pending.read'], facility_estate: ['visitors.pending.read']},
  cameras: {facility_estate: ['facility.cameras.read'], consumer_home: []},
  device_availability: {consumer_home: ['devices.status.read', 'devices.availability.read'], consumer_room: ['devices.status.read', 'devices.availability.read'], facility_estate: []},
  device_history: {consumer_home: ['devices.activity.read', 'devices.failures.read'], facility_estate: []},
  // Physical observed values (lock position, temperature, power) are not exposed
  // by any read module; device facts carry availability/freshness only.
  device_observed_value: {consumer_home: [], consumer_room: [], facility_estate: []},
  scenes: {consumer_home: ['scenes.list.read']},
  // utilities.usage/meter/balance are declared (not enabled); spending/purchases are money, not kWh.
  utilities_usage: {consumer_home: []},
  utilities_service: {consumer_home: ['utilities.active.read', 'utilities.tariff.read', 'utilities.spending.read', 'utilities.purchases.read'], facility_estate: ['utilities.active.read', 'utilities.tariff.read']},
  wallet: {consumer_home: ['wallet.balance.read', 'wallet.transactions.read']},
  home_aggregate: {consumer_home: ['home.summary.read', 'home.attention.read', 'home.activity.read']},
};
const scopeOf = (surface, cls, roomSubject) => surface === 'office_internal' ? 'office_permissioned_snapshot'
  : surface === 'public_corporate' ? 'public_public_corporate'
  : surface === 'facility' ? 'facility_estate'
  : roomSubject && CLASSES[cls]?.consumer_room ? 'consumer_room' : 'consumer_home';

// --- Frozen journey rules. M mandatory, O optional, X not-evidence/excluded.
const EXC_FAC_WALLET = {class: 'wallet', kind: 'AUTHORITY_EXCLUDED_BY_DESIGN', reason: 'Resident wallet is a Consumer-owned private source; no wallet capability is supported or authorised on Facility. The envelope requires considering and refusing it, not collecting it.'};
const EXC_FAC_HOME = {class: 'home_aggregate', kind: 'SCOPE_EXCLUDED_BY_DESIGN', reason: 'Envelope forbids substituting a Consumer home for a missing building scope. A Consumer home aggregate is not Facility evidence.'};
const J = {
  'IQ-EVAL-OMA-005': {M: ['crm'], O: ['office_financial'], note: 'Return to the lead; financial result is the distractor, not required evidence.'},
  'IQ-EVAL-OMA-008': {M: ['crm'], O: ['office_documents'], note: 'Draft-only reply; recipient/thread is CRM evidence. Documents could improve the draft but are not necessary.'},
  'IQ-EVAL-OSA-003': {M: ['corporate_opportunity'], note: 'Caller-supplied opportunity state of this public thread; ownership ambiguity is judged from it.'},
  'IQ-EVAL-OSA-006': {M: ['corporate_partnerships', 'corporate_opportunity'], note: 'Options come from governed partnership knowledge; stated preference from thread objective.'},
  'IQ-EVAL-OSA-007': {M: ['corporate_development', 'corporate_opportunity'], note: 'Public development listing + thread objective; no source can supply the caller\'s planning designation.'},
  'IQ-EVAL-FAC-001': {M: ['maintenance', 'security', 'cameras'], O: ['utilities_service'], note: 'Unknown camera truth must not become outage; unresolved water vs resolved work needs maintenance.'},
  'IQ-EVAL-FAC-002': {M: ['cameras', 'maintenance'], note: 'Conditional camera recovery must not overwrite observed camera state or erase the water issue.'},
  'IQ-EVAL-FAC-007': {M: ['maintenance', 'security'], O: ['cameras', 'utilities_service'], note: 'Unverified safety report escalates against recorded maintenance/security evidence.'},
  'IQ-EVAL-FAC-008': {M: ['maintenance'], O: ['cameras', 'security', 'utilities_service'], X: [EXC_FAC_WALLET], note: 'Operational alternative from maintenance; wallet is deliberately unavailable.'},
  'IQ-EVAL-FAC-009': {M: ['maintenance'], O: ['device_availability'], note: 'Advice/proposal turns need the water issue; device state improves but is not necessary to say a light is not the cause.'},
  'IQ-EVAL-FAC-010': {M: ['maintenance', 'security'], X: [EXC_FAC_HOME], note: 'Estate-level evidence only; building scope is unsupported and must be disclosed, never inferred.'},
  'IQ-EVAL-CON-001': {M: ['device_availability', 'security', 'visitors'], O: ['home_aggregate', 'utilities_service'], note: 'Observed device state is distinguished from security assurance.'},
  'IQ-EVAL-CON-002': {M: ['device_availability'], O: ['home_aggregate', 'scenes'], note: 'Bedtime device availability; scene existence needed only for the opening bedtime turns.'},
  'IQ-EVAL-CON-003': {M: ['utilities_usage'], O: ['wallet', 'device_availability', 'utilities_service'], note: 'Electricity usage cannot be explained without measured consumption; spending is not kWh.'},
  'IQ-EVAL-CON-004': {M: ['cameras', 'security'], O: ['home_aggregate'], note: 'Unobservable camera/security state must never be all-clear.'},
  'IQ-EVAL-CON-005': {M: ['device_availability'], O: ['wallet'], note: 'Return to the device result; the wallet detour is context continuity, not required evidence.'},
  'IQ-EVAL-CON-007': {M: ['maintenance'], O: ['home_aggregate'], note: 'Recorded resolution state is maintenance evidence; a new report must not mutate it.'},
  'IQ-EVAL-CON-008': {M: ['device_availability'], O: ['home_aggregate'], note: 'Corrected room scopes the device read; no physical temperature claim.'},
  'IQ-EVAL-CON-009': {M: [], X: [{class: 'devices/wallet/visitors', kind: 'CROSS_HOME_AUTHORITY_EXCLUDED', reason: 'Other-home records are not collectable by Resident B; own-home evidence is not needed to offer a safe way to raise a concern.'}], note: 'Privacy-boundary advice.'},
  'IQ-EVAL-CON-010': {M: ['device_availability'], O: ['scenes'], note: 'Kitchen light availability; mutation safety is workflow policy, not evidence.'},
};
// Turn overrides (frozen). Everything else inherits the journey rule.
const T = {
  'OMA-005:7': {subject_kind: 'unconfirmed_target'},
  'OMA-008:5': {subject_kind: 'unconfirmed_target'}, 'OMA-008:7': {subject_kind: 'unconfirmed_target'},
  'FAC-002:2': {subject_kind: 'exact_object_in_estate_read'},
  'FAC-009:1': {}, 'FAC-009:2': {}, 'FAC-009:5': {},
  'FAC-009:7': {M: ['maintenance', 'device_history'], note: 'Whether anything physically changed requires device execution history; no Facility estate-scoped device source exists.'},
  'CON-001:4': {M: ['device_availability', 'device_observed_value'], O: ['security', 'visitors', 'home_aggregate'], note: 'Asks whether the lock can actually be verified: needs the observed lock position, which no read capability exposes.'},
  'CON-002:3': {M: ['device_availability'], O: ['home_aggregate', 'scenes']}, 'CON-002:5': {M: ['device_availability'], O: ['home_aggregate', 'scenes']}, 'CON-002:7': {M: ['device_availability'], O: ['home_aggregate', 'scenes']},
  'CON-002:1': {M: ['device_availability', 'scenes'], O: ['home_aggregate']}, 'CON-002:2': {M: ['device_availability', 'scenes'], O: ['home_aggregate']},
  'CON-002:4': {M: ['device_availability', 'device_observed_value'], O: ['home_aggregate', 'scenes'], note: 'Asks whether the current temperature is known: needs a measured value; none is exposed.'},
  'CON-003:4': {M: ['utilities_usage', 'device_history']}, 'CON-003:5': {M: ['utilities_usage', 'device_history']}, 'CON-003:6': {M: ['utilities_usage', 'device_history']},
  'CON-003:7': {M: [], note: 'Advice on what measurement would help is answered from the capability catalogue (usage/meter are declared, not enabled); no evidence read is required.', downstream: 'Advice about a missing measurement is composition over the known capability catalogue.'},
  'CON-008:3': {M: [], note: 'Recalls the user\'s own correction; reference continuity, not evidence.', downstream: 'Reference continuity over conversation context.'},
  'CON-008:7': {M: ['device_availability', 'device_observed_value'], note: 'Asks whether a sensor reading exists: needs a measured value; none is exposed.'},
  'CON-009:7': {downstream: 'No collectable evidence is required; the turn is privacy-boundary advice.'},
  'CON-010:5': {M: [], note: 'Which steps need confirmation is workflow/confirmation policy, not evidence.', downstream: 'Confirmation policy is workflow/action, not evidence collection.'},
};
const ROOM_SUBJECTS = new Set(['bedroom', 'study', 'kitchen']);

const rows = blocked.map(b => {
  const t = byId[b.id];
  const key = `${t.journey_id.replace('IQ-EVAL-', '')}:${t.turn_number}`;
  const j = J[t.journey_id]; assert(j, `no journey rule ${t.journey_id}`);
  const o = T[key] || {};
  const mandatory = o.M || j.M;
  const optional = [...new Set([...(o.O || j.O || [])])].filter(c => !mandatory.includes(c));
  const excluded = [...(j.X || [])];
  // Envelope domains map into classes so nothing the frozen envelope declared is dropped silently.
  const mapped = {devices: ['device_availability', 'device_history', 'device_observed_value', 'devices/wallet/visitors'], home: ['home_aggregate'], wallet: ['wallet'], scenes: ['scenes'], utilities: ['utilities_usage', 'utilities_service'], cameras: ['cameras'], security: ['security'], visitors: ['visitors'], maintenance: ['maintenance'], crm: ['crm'], office_financial: ['office_financial'], office_documents: ['office_documents'], corporate_opportunity: ['corporate_opportunity'], corporate_partnerships: ['corporate_partnerships'], corporate_development: ['corporate_development']};
  const accounted = new Set([...mandatory, ...optional, ...excluded.map(x => x.class), ...(j.X || []).map(x => x.class)]);
  const envelopeUnaccounted = (t.expected.must_consider_domains || []).filter(d => !(mapped[d] || [d]).some(c => accounted.has(c)) && !(o.downstream || j.downstream));
  const roomSubject = ROOM_SUBJECTS.has(String(t.subject_label || '').toLowerCase());
  const surface = t.surface;
  const classRows = mandatory.map(cls => {
    const scope = scopeOf(surface, cls, roomSubject);
    const sources = CLASSES[cls]?.[scope] ?? [];
    return {class: cls, surface_scope: scope, sources, certified_before: sources.filter(s => preCertified.has(s)), uncertified_before: sources.filter(s => !preCertified.has(s)), satisfied_before: sources.some(s => preCertified.has(s)), no_safe_capability: sources.length === 0};
  });
  const missing = classRows.filter(c => c.no_safe_capability);
  const needsHardening = classRows.filter(c => !c.no_safe_capability && !c.satisfied_before);
  const downstream = (o.downstream || j.downstream) && !mandatory.length;
  const disposition = downstream ? 'DOWNSTREAM_NOT_IQ3' : missing.length ? 'MISSING_CAPABILITY_PRODUCT_DEBT' : needsHardening.length ? 'PLANNER_READY_PARTIAL_AFTER_HARDENING' : 'PLANNER_READY_PARTIAL_NOW';
  const alternative = needsHardening.map(c => ({class: c.class, alternative_certified: false}));
  const blockingSources = [...new Set(needsHardening.flatMap(c => c.uncertified_before))];
  return {
    id: b.id, journey_id: t.journey_id, turn_number: t.turn_number, worker: t.worker, surface, objective: t.objective,
    prompt: t.prompt,
    subject: {domains: t.subject, label: t.subject_label || null, target_ref: t.assessment?.target_ref || null, kind: o.subject_kind || (roomSubject ? 'room_scope' : t.subject_label ? 'named_scope_or_object' : 'none')},
    envelope: {must_consider_domains: t.expected.must_consider_domains, must_notice: t.expected.must_notice, acceptable_conclusions: t.expected.acceptable_conclusions, uncertainty_to_disclose: t.expected.uncertainty_to_disclose, iq2_recorded_required_domains: t.required_evidence_domains},
    required_evidence_classes: [...new Set([...mandatory, ...optional])],
    mandatory_evidence_classes: classRows,
    optional_evidence_classes: optional,
    not_evidence_or_excluded: excluded,
    currently_certified_sources: classRows.flatMap(c => c.certified_before),
    blocking_sources: blockingSources,
    blocking_families: [...new Set(blockingSources.map(s => families[s]).filter(Boolean))],
    surface_scope_required: [...new Set(classRows.map(c => c.surface_scope))],
    previous_blocking_reason: b.reason + (b.unresolved_or_exact_subject ? ' [exact/unconfirmed subject]' : '') + (b.missing_domains.length ? ` [no source for envelope domain(s): ${b.missing_domains.join(', ')}]` : ''),
    previous_uncertified_candidate_sources: b.uncertified_sources.length,
    alternative_already_certified_source: alternative,
    downstream_reasoning_not_evidence: Boolean(downstream),
    no_safe_capability: missing.map(c => ({class: c.class, surface_scope: c.surface_scope})),
    disposition_if_sources_hardened: disposition,
    rationale: o.note || j.note || null,
    envelope_domains_unaccounted: envelopeUnaccounted,
  };
});
assert.equal(rows.length, 69);
assert(rows.every(r => r.envelope_domains_unaccounted.length === 0), 'every frozen envelope domain is classified: ' + JSON.stringify(rows.filter(r => r.envelope_domains_unaccounted.length).map(r => [r.id, r.envelope_domains_unaccounted])));
assert(rows.every(r => r.mandatory_evidence_classes.every(c => c.class in CLASSES)));
assert.equal(new Set(rows.map(r => r.id)).size, 69);

// Inversion: source -> mandatory turns it unlocks.
const sources = {};
const touch = s => sources[s] ||= {source: s, family: families[s] || null, certified_before: preCertified.has(s), mandatory_turns: [], mandatory_turns_that_become_ready: [], optional_turns_improved: [], workers: new Set(), surface_scopes: new Set()};
for (const r of rows) {
  for (const c of r.mandatory_evidence_classes) for (const s of c.sources) {
    const e = touch(s); e.mandatory_turns.push(r.id); e.workers.add(r.worker); e.surface_scopes.add(c.surface_scope);
    if (r.disposition_if_sources_hardened === 'PLANNER_READY_PARTIAL_AFTER_HARDENING') e.mandatory_turns_that_become_ready.push(r.id);
  }
  for (const cls of r.optional_evidence_classes) for (const scope of Object.keys(CLASSES[cls] || {})) for (const s of CLASSES[cls][scope]) { const e = touch(s); e.optional_turns_improved.push(r.id); }
}
const DEFECT = {
  CURRENT_STATE: 'Loader catches query/provider errors and returns []; room filter is applied after a 100-row limit; no outcome proof.',
  TRANSACTION_HISTORY: 'Bounded loader without outcome proof.', EXECUTION_AUDIT_HISTORY: 'Failed subqueries are logged and omitted; merged history loses source availability/bounds.',
  BOUNDED_COLLECTION: 'Bounded loader; error sentinel exists but no outcome proof/truncation proof.', OPERATIONAL_COMPOSITE: 'Composite of sources; no outcome proof.',
  PUBLIC_KNOWLEDGE_LOOKUP: 'Fallback text identical for no-match and retrieval failure; provenance lost.', PUBLIC_THREAD_OBJECTIVE: 'Query failure and absent objective both return an empty objective; no ownership/availability proof.',
  HOME_ROOM_AGGREGATE: 'Contributors report failed loaders as empty; aggregate has no outcome proof.',
};
const ranking = Object.values(sources).filter(s => !s.certified_before && s.mandatory_turns.length).map(s => ({
  source: s.source, family: s.family, mandatory_turns: [...new Set(s.mandatory_turns)].length, mandatory_turns_that_become_ready: [...new Set(s.mandatory_turns_that_become_ready)].length,
  optional_turns_improved: [...new Set(s.optional_turns_improved)].length, workers: [...s.workers], surface_scopes: [...s.surface_scopes],
  root_contract_defect: DEFECT[s.family] || 'Uncertified source', safety_truth_impact: /camera|device/.test(s.source) ? 'HIGH: failure/unobservable state can become false all-clear' : /corporate/.test(s.source) ? 'MEDIUM: provenance/authority claims' : 'MEDIUM',
  mandatory_turn_ids: [...new Set(s.mandatory_turns)],
})).sort((a, b) => (b.safety_truth_impact.startsWith('HIGH') - a.safety_truth_impact.startsWith('HIGH')) || b.mandatory_turns - a.mandatory_turns || b.mandatory_turns_that_become_ready - a.mandatory_turns_that_become_ready);
const optionalOnly = Object.values(sources).filter(s => !s.certified_before && !s.mandatory_turns.length && s.optional_turns_improved.length).map(s => ({source: s.source, family: s.family, optional_turns_improved: [...new Set(s.optional_turns_improved)].length, classification: 'NON_BENCHMARK_EVIDENCE_DEBT'}));
const count = k => rows.reduce((m, r) => (m[r[k]] = (m[r[k]] || 0) + 1, m), {});
const summary = {
  rows: rows.length, dispositions: count('disposition_if_sources_hardened'),
  unique_mandatory_blocking_sources: ranking.map(r => r.source), unique_mandatory_blocking_source_count: ranking.length,
  mandatory_classes_without_safe_capability: [...new Set(rows.flatMap(r => r.no_safe_capability.map(c => `${c.class}@${c.surface_scope}`)))],
  rows_only_blocked_by_optional_or_excluded_evidence: rows.filter(r => r.disposition_if_sources_hardened === 'PLANNER_READY_PARTIAL_NOW').length,
  optional_only_uncertified_sources: optionalOnly.length,
};
const out = {
  version: 1, starting_head: startingHead,
  status: 'BLOCKER_GRAPH_FROZEN_PRE_HARDENING',
  inputs: {preimplementation_audit_sha256: sha('artifacts/intelligence-quality-v1-iq3-preimplementation-audit.json'), starting_certification_sha256: createHash('sha256').update(execFileSync('git', ['show', `${startingHead}:artifacts/intelligence-quality-v1-evidence-certification.json`], {maxBuffer: 1e9})).digest('hex')},
  definitions: {
    mandatory: 'The requested assessment cannot responsibly be made without this evidence class (judged from the frozen envelope and the turn request).',
    optional: 'Could improve judgment but a bounded answer is possible without it; never blocks planner readiness.',
    excluded: 'Envelope requires considering and refusing the class (privacy/scope boundary); not collectable by design.',
    downstream: 'The turn requires no evidence read; its difficulty is reference continuity, workflow policy or composition (not IQ-3A).',
    composite: 'home_aggregate composes direct sources; cross-domain composition is IQ-3B. It is optional whenever its direct components are mandatory-covered, and its contributor false-zero defects are fixed independently.',
  },
  class_catalogue: CLASSES, summary, ranking, optional_only_sources: optionalOnly, rows,
};
fs.writeFileSync('artifacts/intelligence-quality-v1-iq3a-blocker-graph.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 1));
console.log(ranking.map(r => `${r.mandatory_turns}/${r.mandatory_turns_that_become_ready} ${r.source} [${r.family}]`).join('\n'));
