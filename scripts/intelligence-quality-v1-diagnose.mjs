// Offline diagnosis only. Does not import runtime, contact services, or rewrite baseline.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const baselinePath = 'artifacts/intelligence-quality-v1-baseline.json';
const baselineHash = 'edd8914212a3661691ebb0046153f8d65b6081c7f5c1e63a4f36e45c0dba667d';
const bytes = readFileSync(baselinePath);
assert.equal(createHash('sha256').update(bytes).digest('hex'), baselineHash);
const baseline = JSON.parse(bytes);
const records = baseline.records;
const tally = (xs, fn) => xs.reduce((a, x) => { const k = fn(x); a[k] = (a[k] || 0) + 1; return a; }, {});
const unique = xs => [...new Set(xs)];
const key = r => `${r.journey_id.slice(8)}:${r.turn_number}`;
const failed = records.filter(r => r.status === 'FAIL');
assert.equal(records.length, 280);
assert.equal(unique(records.map(r => r.journey_id)).length, 40);
assert.deepEqual(tally(records, r => r.status), { FAIL: 235, PASS: 40, BLOCKED: 5 });
assert.deepEqual(tally(failed, r => r.severity), { P0: 4, P1: 217, P2: 14 });
assert.equal(records.filter(r => r.observations.persistence_saved && r.trace.persistence_saved).length, 280);
assert.equal(records.filter(r => r.trace.trace_id && r.trace.trace_id === r.observations.trace_id).length, 280);
assert.equal(unique(records.map(r => r.trace.trace_id)).length, 280);

const core = 'src/oyi-core/';
const orch = core + 'orchestration/ConversationOrchestrator.ts';
const parser = core + 'interpretation/SemanticFrameParser.ts';
const resultSets = core + 'context/resultSetContext.ts';
const followUp = core + 'interpretation/followUpResolver.ts';
const publicCapability = core + 'capabilities/PublicOpportunityCapabilityModule.ts';
const reads = core + 'capabilities/ReadCapabilityModules.ts';
const office = core + 'capabilities/OfficeCorporateCapabilityModules.ts';
// Definition order is stable ID order, not an implied repair order.
const definitions = [
  ['001', 'Unchecked universal quantifier in list summaries', 'RESPONSE_COMPOSITION', 'F', [office],
    'summarizeListAnswer treats one nonzero category as covering the whole collection; the category count is not compared with the total. Lead reason compression also overgeneralizes heterogeneous records.',
    'Compute quantifiers from measured coverage; retain heterogeneous reasons and unknowns.', []],
  ['002', 'Failed callback bridge converted into a follow-up promise', 'VERIFICATION', 'F', [publicCapability, core + 'ingress/officeHandoffBridge.ts'],
    'composeCallbackAnswer promises team contact on result.ok=false. In this fixture the bridge returns not_configured before HTTP; no accepted handoff establishes that promise.',
    'Compose only from acknowledged handoff status and expose an honest unavailable/retry outcome.', []],
  ['003', 'Negation misses cancellation and creates/retains device intent', 'WORKFLOW', 'S', [parser, orch, core + 'capabilities/DeviceActionCapabilityModules.ts', core + 'domains/devices/deviceActionAdapter.ts'],
    'Power interpretation lacks a negation veto; cancellation matcher misses both observed phrases. An awaiting_clarification workflow consumes subsequent null-domain questions instead of cancelling.',
    'Interpret negation before mutation; cancel/invalidate current proposal before clarification continuation, while preserving ActionService approval.', []],
  ['004', 'Lexical domain/operation capture displaces the cognitive request', 'INTERPRETATION', 'A', [parser, core + 'runtime/languageUnderstanding.ts', core + 'capabilities/CapabilityService.ts'],
    'Generic why/recommendation/change/issue/room/document wording collapses into domain lookup or device diagnosis. Some natural readings have no lexical mapping. Downstream reasoning never receives the intended move.',
    'Preserve question modality and context before domain-specific operation matching; exercise existing semantic contract, not a phrase catalogue.', []],
  ['005', 'Support predicate/operation precedence selects the wrong eligible module', 'CAPABILITY_SELECTION', 'B', [core + 'capabilities/CapabilityService.ts', reads, core + 'domains/roomHome/roomHomeCapabilities.ts'],
    'Wallet keyword supports history even for balance; list operation scores history above balance. Home inform attention phrasing misses Home supports and reaches an ineligible Facility overview candidate.',
    'Align supports predicates and operation fit with the existing semantic contract; preserve surface eligibility and authority.', ['IQRC-004']],
  ['006', 'No governed conversational cognitive-move destination', 'OBJECTIVE_STATE', 'A', [core + 'contracts/semanticFrame.ts', parser, orch],
    'Unscoped assessment/advice/verification/next-step turns become inform/list without a usable objective. Canonical fallback terminates in catalogue/unsupported text. The runtime has bounded reads, not a general assessment continuation for these turns.',
    'Represent the requested cognitive move in existing conversation context and invoke governed evidence/response owners; do not revive legacy chat.', ['IQRC-004', 'IQRC-005']],
  ['007', 'Public qualification objective has a narrow re-entry/fact contract', 'OBJECTIVE_STATE', 'G', [core + 'context/publicOpportunityObjective.ts', publicCapability, parser],
    'An existing development objective does not keep arbitrary ownership/title/location/constraint/judgment turns in corporate_opportunity. Facts outside the narrow extractor are not integrated, so public follow-ups become catalogues or lose corrected context.',
    'Extend the existing short-lived public objective re-entry and typed fact/correction handling; separate claims from verified knowledge.', ['IQRC-004']],
  ['008', 'Material claims/corrections have no assessment dependency update', 'REASSESSMENT', 'H', [orch, resultSets, core + 'context/officeConversationContext.ts', core + 'context/publicOpportunityObjective.ts'],
    'Persistence retains text but not a claim attached to a current assessment and its dependencies. Material updates/corrections do not revise a conclusion, distinguish source status, or trigger conditional reassessment.',
    'Use thread metadata for a bounded assessment projection with claim provenance and invalidation; reuse result references and public objective state.', ['IQRC-006', 'IQRC-007', 'IQRC-009']],
  ['009', 'Reference continuation selects raw/stale sets instead of human subject', 'REFERENCE_RESOLUTION', 'G', [followUp, resultSets, orch],
    'Follow-up dispatch precedes ordinary capability routing. Raw active sets/selected records are used when the intended derived recommendation, filter or prior domain is absent. Ambiguous selection is sometimes safe but follows earlier lost objective state.',
    'Bind references to the response-derived set/objective with provenance; do not fall through to unrelated active domains.', ['IQRC-006', 'IQRC-010']],
  ['010', 'Question qualifiers are not carried into evidence selection', 'EVIDENCE_SELECTION', 'C', [office, reads, orch],
    'Named comparison/qualified lead, visitor temporal scope and building scope return generic collections/counts. Authorized retrieval alone does not preserve the subset/relationship needed by the question.',
    'Preserve named/temporal/spatial qualifiers through existing evidence loaders and result sets; report insufficient scoped evidence instead of broad substitution.', ['IQRC-004']],
  ['011', 'Read/status templates substitute for conditional judgment', 'REASONING', 'D', [office, reads, orch],
    'A relevant subject and bounded evidence are available, but answer/continuation handlers repeat status/count rather than explain a comparison, hypothetical, evidence limit or verification criterion.',
    'Extend existing capability response composition with evidence-bounded reasoning and explicit uncertainty; do not grant new action authority.', ['IQRC-006', 'IQRC-010']],
  ['012', 'Priority ranking omits actionable-state eligibility', 'PRIORITIZATION', 'D', [followUp, orch],
    'prioritizeResultSet sorts the retained list by priority metadata without removing resolved maintenance. The next-action answer recommends starting resolved work.',
    'Filter actionable candidates before ranking, retaining resolved evidence only for explanation/comparison.', []],
  ['013', 'Public next-move policy acknowledges instead of qualifying', 'INITIATIVE', 'E', [publicCapability, core + 'context/publicOpportunityObjective.ts'],
    'Known intake facts survive but static acknowledgments hand the next question back to the visitor. Requirements suppress title_document_status via NOT_YET_USEFUL_TO_ASK, despite its qualification relevance.',
    'Compute one useful next qualification move from known facts and canonical requirements; avoid repeatedly requesting supplied facts.', ['IQRC-007']],
  ['014', 'Non-executing action/meta-action requests lack a truthful terminal explanation', 'ACTION_JUDGMENT', 'A', [orch, parser],
    'Requests about authorization, hypothetical yes, cancellation with no draft, or verification yield generic unsupported/catalogue answers. These five observations contain no live executable action; they are not observed authority bypasses.',
    'Reuse workflow/action state for an explicit explanation or no-op cancellation, without creating a proposal.', ['IQRC-003', 'IQRC-006']],
  ['015', 'Scope-safe answer does not explicitly reject the requested foreign scope', 'RESPONSE_COMPOSITION', 'F', [reads, orch],
    'Cross-home requests read only the actor home but answer with an own-scope empty result rather than explaining that the requested other-home data is forbidden.',
    'Carry the rejected requested scope into response explanation; never widen evidence access.', []],
  ['016', 'Fixture financial projection lacks estate records', 'EVIDENCE_RETRIEVAL', 'X', [office],
    'Synthetic financial input supplies portfolio totals but an empty estates collection; financial.summary.read consumes estates. The benchmark cannot establish the requested financial comparison.',
    'In a later approved fixture revision supply the authoritative financial projection; preserve this baseline.', []],
  ['017', 'Fixture Facility device scope does not contain authorized shared devices', 'AUTHORITY', 'X', [reads],
    'Available devices are resident-home private, while Facility test identity lacks that home scope. The denial is not proof of broken authority or poor device reasoning.',
    'Add approved estate/shared-device fixtures later; do not grant Facility private-home authority.', []],
  ['018', 'Reused fixture prediction lacks reproducible provenance', 'EVIDENCE_RETRIEVAL', 'X', [reads],
    'The preexisting security prediction cannot be independently reconstructed from the isolated seed; a meaningful judgment score is unavailable.',
    'Use deterministic provenance-complete prediction evidence in a future fixture revision.', []],
];
const roots = definitions.map(([n,name,layer,pattern,owners,description,repair,dependencies]) => ({
  id: `IQRC-${n}`, name, primary_layer: layer, diagnostic_pattern: pattern,
  canonical_owners: owners, description, smallest_plausible_repair_boundary: repair, dependencies,
  why_root_not_symptom: `Specific shared contract/code boundary: ${description} Response wording alone is not the diagnosis.`,
  causal_status: Number(n) >= 16 ? 'fixture-limited' : 'source-and-frozen-observation supported; repair causality not experimentally tested',
}));
const rootById = Object.fromEntries(roots.map(r => [r.id,r]));
const set = s => new Set(s.split(/\s+/).filter(Boolean));
const collision = set('CON-001:1 CON-005:3 CON-008:4');
const claims = set('OMA-001:4 OMA-002:4 OMA-003:4 OMA-004:3 OMA-004:4 OMA-006:3 OMA-007:3 OMA-007:4 OMA-008:4 OMA-010:5 FAC-007:2 CON-002:3 CON-007:3 CON-008:1 CON-008:2 CON-008:3');
function classify(r) {
  const k = key(r), c = r.review_code;
  if (c === 'D') return r.worker === 'OMA' ? '016' : r.worker === 'FAC' ? '017' : '018';
  if (k.startsWith('CON-010:') && r.turn_number >= 4) return '003';
  if (collision.has(k)) return '005';
  if (claims.has(k) || c === 'U') return '008';
  if (r.worker === 'OSA' && ['O','C'].includes(c)) return '007';
  if (k === 'OSA-010:5') return '013';
  const map = { F:'001',L:'001',H:'002',I:'004',O:'006',C:'009',E:'010',R:'011',J:'012',N:'013',A:'014',Q:'015' };
  assert.ok(map[c], `Unmapped ${k} ${c}`);
  return map[c];
}
const failureMap = records.filter(r => r.status !== 'PASS').map(r => {
  const id = `IQRC-${classify(r)}`, root = rootById[id];
  const obs = r.observations, tr = r.trace;
  const frame = obs.semantic_frame;
  const responseEvidence = r.response.context?.module_facts?.evidence_count ?? null;
  const related = unique([...(id === 'IQRC-001' ? ['IQRC-006'] : []), ...root.dependencies]);
  return {
    journey_id:r.journey_id, turn_number:r.turn_number, worker:r.worker,surface:r.surface,
    prompt_reference_id:key(r),prompt:r.prompt,baseline_record_index:records.indexOf(r),
    expected_behaviour_summary:[...r.envelope.must_notice,...r.envelope.expected_context_updates].join(' '),
    actual_behaviour_summary:r.review_reason,actual_response:r.response.answer ?? r.response.summary,
    scores:r.scores,status:r.status,severity:r.severity,
    diagnostic_severity:id === 'IQRC-003' ? 'P0_LATENT_ACTION_SAFETY' : r.severity,
    severity_note:id === 'IQRC-003' ? 'Frozen P1 unchanged. Negated power intent remains live; execution was not observed. See report for required target/power-operation/approval prerequisites and adapter guard.' : null,
    primary_failing_layer:root.primary_layer,
    secondary_failing_layers:unique([r.failure_layer,...related.map(id=>rootById[id].primary_layer)]).filter(x=>x && x!==root.primary_layer),
    shared_root_cause_id:id,secondary_root_cause_ids:related,
    diagnostic_pattern:root.diagnostic_pattern,
    trace_id:tr.trace_id,semantic_domain:frame?.domain ?? tr.domain,
    semantic_operation:frame?.operation ?? tr.operation,semantic_frame_available:!!frame,
    resolution_outcome:tr.resolution_outcome,capability:obs.selected_capability,
    trace_capability:tr.capability_key,authority:tr.authority_result,
    evidence_count:tr.evidence_count,response_evidence_count:responseEvidence,
    evidence_count_note:tr.evidence_count === null ? 'Not recorded at this trace boundary; NOT evidence of zero retrieval. Inspect frozen response/context.' : null,
    terminal_outcome:tr.terminal_outcome,persistence:obs.persistence_saved,
    latency_ms:r.latency_ms,trace_latency_ms:tr.total_latency_ms,
    workflow:obs.workflow,current_turn_execution:obs.current_turn_execution,
    failure_ownership:r.status==='BLOCKED'?'DATA_FIXTURE':'CORE_COGNITIVE',
    proposed_canonical_owner:root.canonical_owners,
    source_evidence:root.description,
    diagnostic_confidence:root.causal_status,
  };
});
assert.equal(failureMap.length,240);
assert.equal(unique(failureMap.map(r=>r.prompt_reference_id)).length,240);
for (const root of roots) {
  const members = failureMap.filter(r=>r.shared_root_cause_id===root.id);
  assert.ok(members.length,`Empty cluster ${root.id}`);
  root.turns_affected = members.length;
  root.failure_count = members.filter(r=>r.status==='FAIL').length;
  root.blocked_count = members.filter(r=>r.status==='BLOCKED').length;
  root.frozen_severity_counts = tally(members.filter(r=>r.severity),r=>r.severity);
  root.diagnostic_latent_p0_count = members.filter(r=>r.diagnostic_severity==='P0_LATENT_ACTION_SAFETY').length;
  root.workers_affected = unique(members.map(r=>r.worker));
  root.journeys_affected = unique(members.map(r=>r.journey_id));
  root.members = members.map(r=>r.prompt_reference_id);
  root.seven_dimensions_affected = Object.keys(records[0].scores).filter(d=>members.some(r=>r.scores[d]!==null && r.scores[d]<=2));
  root.technical_layers_involved = unique(members.flatMap(r=>[r.primary_failing_layer,...r.secondary_failing_layers]));
  root.representative_examples = members.slice(0,3).map(r=>({turn:r.prompt_reference_id,prompt:r.prompt,actual:r.actual_response,trace_id:r.trace_id}));
}
assert.equal(roots.reduce((s,r)=>s+r.failure_count,0),235);
assert.equal(roots.reduce((s,r)=>s+r.blocked_count,0),5);
const dimensions = Object.fromEntries(Object.keys(records[0].scores).map(d=>{
  const scored=records.filter(r=>r.scores[d]!==null), values=scored.map(r=>r.scores[d]);
  const bad=failureMap.filter(r=>r.status==='FAIL' && r.scores[d]!==null && r.scores[d]<=2);
  const dist=Object.fromEntries([0,1,2,3,4,5].map(v=>[v,values.filter(x=>x===v).length]));
  const mean=values.reduce((a,b)=>a+b,0)/values.length;
  assert.deepEqual(dist,baseline.review.dimensions[d].distribution);
  assert.equal(mean,baseline.review.dimensions[d].mean);
  return [d,{scored:scored.length,not_observable:280-scored.length,mean,distribution:dist,
    failed_turns_scoring_0_to_2:bad.length,workers:unique(bad.map(r=>r.worker)),
    root_causes:tally(bad,r=>r.shared_root_cause_id)}];
}));
const workers=Object.fromEntries(['OMA','OSA','FAC','CON'].map(w=>{
  const rs=records.filter(r=>r.worker===w), fs=failureMap.filter(r=>r.worker===w && r.status==='FAIL');
  return [w,{totals:tally(rs,r=>r.status),root_causes:tally(fs,r=>r.shared_root_cause_id),dimensions:Object.fromEntries(Object.keys(dimensions).map(d=>{
    const vs=rs.map(r=>r.scores[d]).filter(v=>v!==null);return [d,{scored:vs.length,mean:vs.reduce((a,b)=>a+b,0)/vs.length}];
  }))}];
}));
const patterns={
  A:'Wrong/underspecified cognitive interpretation; downstream judgment not fairly measurable.',
  B:'Right broad domain; predicate/operation selection reaches wrong capability (semantic detail may contribute).',
  C:'Relevant domain reached but evidence subset/scope/relationship insufficient for requested conclusion.',
  D:'Relevant evidence supports a bounded explanation, but status repetition/priority eligibility fails; not proof all evidence for optimal decision exists.',
  E:'Useful intake state survives; next move is weak or ignores a material qualification requirement.',
  F:'Scoped source/action state available; composition misstates coverage, commitment or requested scope.',
  G:'Context/reference/re-entry failed before any valid comparative reasoning.',
  H:'Claim/correction/reassessment dependency not represented.',
  S:'Negated mutation retained as workflow intent; latent safety risk, no execution observed.',
  X:'Fixture cannot establish sufficient authorized evidence/provenance.',
};
const verification={baseline_commit:'e092ff45c9114a1aa9eab75b11e44b4895ce764e',baseline_sha256:baselineHash,
  journeys:40,turns:280,totals:tally(records,r=>r.status),frozen_severity:tally(failed,r=>r.severity),
  persisted:280,trace_correlated:280,unique_traces:280,failed_clusters:15,fixture_clusters:3,
  diagnostic_latent_p0_observations:4,diagnostic_p0_distinct_root_causes:3,
  note:'Frozen severity unchanged. Diagnostic P0 is four observed truth failures plus four workflow observations of one latent safety defect; no executed physical mutation was observed.'};
assert.equal(records.filter(r=>r.observations.current_turn_execution===true).length,0);
for (const root of roots) for (const path of root.canonical_owners) readFileSync(path);
const inventory={version:1,verification,method:'Offline explicit source-backed decomposition; no replay, counterfactual repair experiment, fixture edit, evaluator edit or runtime change. Root IDs are diagnostic hypotheses at canonical repair boundaries, not measured causal effect sizes.',
  dimension_failure_definition:'FAIL turns with a non-null score <=2; correlated downstream scores are not independent causes.',
  dimensions,workers,diagnostic_patterns:Object.entries(patterns).map(([id,description])=>({id,description,failures:failureMap.filter(r=>r.status==='FAIL'&&r.diagnostic_pattern===id).length,blocked:failureMap.filter(r=>r.status==='BLOCKED'&&r.diagnostic_pattern===id).length})),
  root_causes:roots.sort((a,b)=>{
    const safety=r=>(r.frozen_severity_counts.P0||0)+r.diagnostic_latent_p0_count>0?0:r.failure_count?1:2;
    return safety(a)-safety(b)||b.failure_count-a.failure_count||a.id.localeCompare(b.id);
  }),
  oma_001:failureMap.filter(r=>r.journey_id==='IQ-EVAL-OMA-001')};
writeFileSync('artifacts/intelligence-quality-v1-failure-map.json',JSON.stringify({version:1,verification,records:failureMap},null,2)+'\n');
writeFileSync('artifacts/intelligence-quality-v1-root-causes.json',JSON.stringify(inventory,null,2)+'\n');
const reportPath='docs/INTELLIGENCE_QUALITY_V1_ROOT_CAUSE_ANALYSIS.md';
const report=readFileSync(reportPath,'utf8');
const marker='<!-- GENERATED DIAGNOSTIC ACCOUNTING -->';
assert.ok(report.includes(marker));
const lines=[
  '## Reproducible accounting', '',
  '| Root cause | Description | FAIL | BLOCKED | Frozen P0/P1/P2 |',
  '|---|---|---:|---:|---|',
  ...roots.map(r=>`| ${r.id} | ${r.name} | ${r.failure_count} | ${r.blocked_count} | ${['P0','P1','P2'].map(k=>r.frozen_severity_counts[k]||0).join('/')} |`),
  '| **Total** | **15 failure clusters + 3 fixture clusters** | **235** | **5** | **4/217/14** |','',
  '### Worker profiles','',
  '| Worker | PASS/FAIL/BLOCKED | Primary root causes (count) |','|---|---|---|',
  ...Object.entries(workers).map(([w,x])=>`| ${w} | ${x.totals.PASS||0}/${x.totals.FAIL||0}/${x.totals.BLOCKED||0} | ${Object.entries(x.root_causes).sort((a,b)=>b[1]-a[1]).map(([id,n])=>`${id}: ${n}`).join('; ')} |`),'',
  '### Seven dimensions','',
  'Ordinal frozen evaluator scores, not a calibrated human panel. Failure count here means FAIL turns scoring 0–2 on that dimension; null is unobservable, not zero. Dimensions overlap and must not be summed as independent failures.','',
  '| Dimension | Scored / null | Mean | Distribution 0/1/2/3/4/5 | FAIL scoring 0–2 |','|---|---|---:|---|---:|',
  ...Object.entries(dimensions).map(([d,x])=>`| ${d} | ${x.scored}/${x.not_observable} | ${x.mean.toFixed(3)} | ${Object.values(x.distribution).join('/')} | ${x.failed_turns_scoring_0_to_2} |`),'',
  '| Worker | Understanding | Context | Evidence | Judgment | Initiative | Communication | Action judgment |','|---|---:|---:|---:|---:|---:|---:|---:|',
  ...Object.entries(workers).map(([w,x])=>`| ${w} | ${Object.values(x.dimensions).map(d=>d.mean.toFixed(3)).join(' | ')} |`),'',
  '### Trace diagnostic patterns','',
  'These are source-assisted diagnoses, not labels emitted by production traces. A–F alone are insufficient: G/H/S separate broken continuation and safety rather than mislabeling them as poor reasoning. Null trace evidence counts do not mean zero evidence.','',
  '| Pattern | Interpretation | FAIL | BLOCKED |','|---|---|---:|---:|',
  ...inventory.diagnostic_patterns.map(p=>`| ${p.id} | ${p.description} | ${p.failures} | ${p.blocked} |`),'',
  '### Complete root-cause inventory','',
  ...roots.flatMap(r=>[
    `#### ${r.id} — ${r.name}`,'',r.description,'',
    `- Canonical owners: ${r.canonical_owners.map(p=>'`'+p+'`').join(', ')}.`,
    `- Scope: ${r.workers_affected.join(', ')}; ${r.journeys_affected.length} journeys; ${r.turns_affected} turns.`,
    `- Frozen severity P0/P1/P2: ${['P0','P1','P2'].map(k=>r.frozen_severity_counts[k]||0).join('/')}; diagnostic latent P0 observations: ${r.diagnostic_latent_p0_count}.`,
    `- Dimensions scoring 0–2: ${r.seven_dimensions_affected.join(', ')||'not scored'}.`,
    `- Technical layers: ${r.technical_layers_involved.join(', ')}.`,
    `- Dependencies: ${r.dependencies.join(', ')||'none'}.`,
    `- Repair boundary (not implemented): ${r.smallest_plausible_repair_boundary}`,
    `- Why causal: ${r.why_root_not_symptom}`,
    `- Evidence strength: ${r.causal_status}.`,
    `- Complete membership: ${r.members.join(', ')}.`,
    '',...r.representative_examples.map(e=>`Example **${e.turn}**, trace \`${e.trace_id}\`: “${e.prompt}” → ${e.actual.replace(/\n/g,' ').slice(0,280)}${e.actual.length>280?'…':''}`),''
  ]),
];
writeFileSync(reportPath,(report.split(marker)[0]+marker+'\n\n'+lines.join('\n')).trimEnd()+'\n');
console.log(JSON.stringify({verification,clusters:roots.map(r=>[r.id,r.failure_count,r.blocked_count]),patterns:inventory.diagnostic_patterns},null,2));
