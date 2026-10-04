// Read-only diagnostic of the certified post-IQ2 execution; never runs the brain.
// Candidate matching is NOT authorization to execute a collector.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';

assert.equal(process.env.SUPABASE_URL, 'http://127.0.0.1:55421');
const require = createRequire(import.meta.url);
for (const pkg of ['bullmq', 'ioredis']) {
  const p = require.resolve(pkg);
  class Inert { on() { return this; } quit() { return Promise.resolve(); } }
  Inert.default = Inert; Inert.Redis = Inert; Inert.Queue = Inert; Inert.Worker = Inert;
  require.cache[p] = {id:p,filename:p,loaded:true,exports:Inert};
}
// Inventory inspection must perform NO network access, not even a local read.
globalThis.fetch = async () => { throw Error('IQ3_INVENTORY_NETWORK_FORBIDDEN'); };
const {ensureRegistered} = await import('../dist/oyi-core/orchestration/ConversationOrchestrator.js');
const {capabilityRegistry} = await import('../dist/oyi-core/capabilities/CapabilityRegistry.js');
const {capabilityService} = await import('../dist/oyi-core/capabilities/CapabilityService.js');
ensureRegistered();
const sourcePath = 'artifacts/intelligence-quality-v1-iq2c-results.json';
const source = JSON.parse(fs.readFileSync(sourcePath));
const hash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const raw = JSON.parse(fs.readFileSync(source.raw_path));
assert.equal(hash(source.raw_path), source.raw_sha256);
assert.equal(source.records.length, 280);
assert.equal(raw.records.length, 280);
const tally = (rs, fn) => rs.reduce((a,r) => (a[fn(r)] = (a[fn(r)] || 0) + 1,a),{});
assert.deepEqual(tally(source.records,r=>r.status),{FAIL:224,BLOCKED:5,PASS:51});
assert.equal(source.records.filter(r=>r.persistence_saved).length,280);
assert.equal(source.records.filter(r=>r.trace?.trace_id).length,280);
const fixtureSource = fs.readFileSync('scripts/wave11-behavioural-torture-harness.mjs','utf8');
const {actorFor,oisContext} = new Function(`${fixtureSource.slice(fixtureSource.indexOf('const ids = '),fixtureSource.indexOf('function expected(prompt)'))};return {actorFor,oisContext};`)();
const inventory = capabilityRegistry.all().map(m=>({
  key:m.key,domain:m.domain,rollout:m.rolloutStatus,risk:m.risk_class,
  operations:m.operations||[],surfaces:m.supported_surfaces||[],
  scope_requirements:m.scope_requirements||[],permissions:m.permission_requirements||[],
  evidence_requirements:m.evidence_requirements||[],
  has_read_handler:typeof m.buildReadResponse==='function',
}));
const downstream = new Set(source.gaps.filter(g=>g.downstream_only).map(g=>g.id));
assert.equal(downstream.size,109);
// Individually reviewed current answers/traces. These are primary observed
// boundaries, not predictions that repairing that layer will pass the turn.
const reviewedGroups = {
  INITIATIVE: ['OSA-001:1','OSA-001:2','OSA-001:3','OSA-001:7','OSA-002:1','OSA-002:4','OSA-004:1','OSA-004:3','OSA-005:1','OSA-005:2','OSA-008:1','OSA-008:5','OSA-008:7','OSA-010:2','OSA-010:3','OSA-010:4','OSA-010:5','FAC-001:6','FAC-003:5','FAC-006:7','FAC-007:5','FAC-009:3'],
  EVIDENCE_SELECTION: ['OMA-008:1','FAC-005:1','CON-001:5','CON-006:1','CON-003:3'],
  EVIDENCE_RETRIEVAL: ['FAC-004:2','FAC-004:3','FAC-004:5','FAC-004:6','FAC-004:7','FAC-010:1'],
  REASONING_JUDGMENT: ['OSA-001:6','OSA-004:4','OSA-004:6','FAC-001:5','FAC-002:3','FAC-005:4','CON-004:4'],
  REFERENCE_CONTINUITY: ['OMA-008:2','FAC-005:2','FAC-005:3','FAC-007:4','CON-005:5','CON-006:4','CON-010:2'],
  RESPONSE_COMPOSITION: ['OSA-002:7','OSA-008:6','OSA-010:7','FAC-001:7','FAC-003:2','FAC-008:5','FAC-010:4','CON-005:7','CON-009:3','CON-009:4','CON-010:7'],
  WORKFLOW_ACTION: ['OMA-009:3','CON-010:3'],
  EVIDENCE_PLANNING: ['CON-006:7'],
};
const reviewed = new Map();
for(const [category,ids] of Object.entries(reviewedGroups)) for(const id of ids) {
  assert(!reviewed.has(id)); reviewed.set(id,category);
}
const rows = source.records.filter(r=>r.status!=='PASS').map(r=>{
  const original = raw.records.find(x=>x.journey_id===r.journey_id&&x.turn_number===r.turn_number);
  assert.equal(original.prompt,r.prompt);
  assert.equal(original.response.answer,r.answer);
  const s = r.assessment_context;
  const required = s?.required_evidence_domains||[];
  const facts = original.response.facts||[];
  const present = [...new Set(facts.filter(f=>f.freshness==='fresh'&&!['unavailable','permission_restricted'].includes(f.truth_state)).map(f=>f.domain))];
  const missing = required.filter(d=>!present.includes(d));
  const role = original.actor_role;
  assert(role,'Frozen raw turn must identify its actor role');
  const actor = actorFor(role,r.surface);
  const verifiedContext = oisContext(actor,r.surface);
  const matches = inventory.filter(m=>m.risk==='read'&&m.evidence_requirements.some(e=>required.includes(e.domain)));
  const candidates = matches.map(m=>({
    ...m,
    authority:capabilityService.canUse(m.key,{actor,oisContext:verifiedContext,surface:r.surface}),
    authority_basis:'Fixture actor/context only; request-specific scope and collector scope still require verification.',
  }));
  const unavailable = facts.filter(f=>['unavailable','permission_restricted'].includes(f.truth_state)||['unavailable','provider_disconnected'].includes(f.freshness));
  let classification='OTHER',basis='Requires individual review; not inferred from the frozen primary root cause.';
  // These are conservative diagnostics, NOT a regrade or proof of sufficiency.
  if(r.status==='BLOCKED') { classification='FIXTURE_BLOCKED';basis=r.review_reason; }
  else if(unavailable.length) {classification='EVIDENCE_RETRIEVAL';basis='Current returned facts explicitly mark at least one source unavailable/restricted; inspect source details before judging conclusions.';}
  else if(s&&!s.suspended&&missing.length&&original.response.execution?.assessment_status==='evidence_needed') {
    classification='EVIDENCE_PLANNING';basis='Active understood assessment terminates evidence_needed; required domains lack current returned fresh facts. A cached domain label is not proof of reusable evidence.';
  } else if(s&&!s.suspended&&r.cognitive_objective==='reassess') {classification='REASSESSMENT';basis='Reassessment is recognized; current answer does not satisfy the frozen change-of-judgment envelope. Evidence sufficiency remains separately unresolved.';}
  else if(s&&!s.suspended&&r.cognitive_objective==='prioritize') {classification='PRIORITIZATION';basis='Prioritization is recognized; no accepted ranked conclusion. Missing evidence is separately recorded, not assumed sufficient.';}
  else if(s&&!s.suspended&&['compare','explain','assess'].includes(r.cognitive_objective)&&present.length) {classification='REASONING_JUDGMENT';basis='Assessment and returned facts exist but accepted conclusion is absent; coverage still needs record-level review, so this is provisional, not proof of a pure judgment failure.';}
  else if(s&&!s.suspended&&r.cognitive_objective==='advise'&&present.length) {classification='INITIATIVE';basis='Advice recognized with current facts; useful next move absent. Coverage must still be reviewed.';}
  const id=r.journey_id.slice(8)+':'+r.turn_number;
  if(classification==='OTHER'&&reviewed.has(id)) {
    classification=reviewed.get(id);
    basis='Individual current-answer review; see prompt, expected envelope, actual answer, returned fact references and trace in this row. No frozen root-cause remapping used.';
  }
  if(classification==='OTHER') {
    basis='Current route gives a capability catalogue/unsupported destination rather than attaching supplied facts or answering the question. Interpretation/subject-state or ordinary capability selection remains upstream; multi-read planning alone cannot repair it.';
  }
  return {
    id,journey_id:r.journey_id,turn_number:r.turn_number,worker:r.worker,surface:r.surface,
    prompt:r.prompt,status:r.status,severity:r.severity,expected:r.envelope,answer:r.answer,
    classification,classification_status:'OBSERVED_PRIMARY_BOUNDARY_NOT_PREDICTED_REPAIR',classification_basis:basis,
    previous_boundary:r.remaining_primary_boundary,objective:r.cognitive_objective,
    subject:s?.subject_domains||[],subject_label:s?.subject_label||null,
    assessment:s,required_evidence_domains:required,
    context_claimed_available_domains:s?.available_evidence_domains||[],
    returned_fresh_fact_domains:present,required_domains_without_returned_fresh_facts:missing,
    evidence_sufficiency:'NOT_PROVEN_BY_DOMAIN_PRESENCE',
    fact_references:facts.map(f=>({id:f.fact_id,domain:f.domain,truth:f.truth_state,freshness:f.freshness,object:f.object,source_type:f.source_type,scope:f.scope})),
    candidate_capabilities:candidates,
    iq2_downstream_only:downstream.has(id),
    iq3_investigation_candidate:downstream.has(id)&&Boolean(s&&!s.suspended&&missing.length),
    trace:r.trace,latency_ms:r.latency_ms,persistence_saved:r.persistence_saved,
  };
});
const result={
  starting_head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  status:'PREIMPLEMENTATION_OBSERVED_BOUNDARIES_COLLECTOR_AUDIT_PENDING',
  source:{path:sourcePath,sha256:hash(sourcePath),raw_sha256:source.raw_sha256},
  baseline:{turns:280,pass:51,fail:224,blocked:5,persisted:280,trace_correlated:280},
  failure_counts:tally(rows.filter(r=>r.status==='FAIL'),r=>r.classification),
  individual_review_required:rows.filter(r=>r.classification==='OTHER').map(r=>r.id),
  downstream_only:109,iq3_investigation_candidates:rows.filter(r=>r.iq3_investigation_candidate).length,
  candidate_caveat:'Missing returned fresh facts identifies investigation candidates, not proven missing source data. Single returned fact does not establish domain coverage. Collector authorization/timeout/zero-result semantics require audit before execution.',
  inventory,records:rows,
};
const destination='artifacts/intelligence-quality-v1-iq3-preimplementation-audit.json';
assert(!fs.existsSync(destination),'Do not overwrite pre-change evidence');
fs.writeFileSync(destination,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({baseline:result.baseline,counts:result.failure_counts,candidates:result.iq3_investigation_candidates,other_enumerated:result.individual_review_required.length}));
