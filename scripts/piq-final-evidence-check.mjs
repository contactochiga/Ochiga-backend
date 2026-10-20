// Read-only verification of frozen inputs and independently produced grades.
// No requests, grading, expectation changes or runtime execution.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const prefix = 'artifacts/piq-20261016';
const read = file => JSON.parse(fs.readFileSync(file));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const seal = read(`${prefix}-seal.json`);
for (const file of seal.files) assert.equal(sha(fs.readFileSync(file.path)), file.sha256, file.path);
const integrity = read(`${prefix}-capture-integrity.json`);
assert.equal(sha(fs.readFileSync(`${prefix}-seal.json`)), integrity.seal_sha256);
const booleans = ['objective', 'subject', 'reference', 'operation', 'answer_target', 'clarification_emitted', 'clarification_required'];
const boundaries = ['objective', 'subject_scope', 'reference_context', 'capability_routing', 'evidence', 'judgment', 'answer_target', 'composition', 'action_governance', 'missing_capability', 'evaluation_infrastructure', 'none'];
function validateGrade(g, original = false) {
  assert(['PASS', 'PARTIAL', 'FAIL', 'INFRASTRUCTURE_BLOCKED'].includes(g.verdict), g.id);
  assert(['NONE', 'P0', 'P1', 'P2'].includes(g.severity), g.id);
  for (const key of booleans) assert.equal(typeof g[key], 'boolean', `${g.id}:${key}`);
  // Preserve original grader vocabulary errors; the adjudicator must resolve
  // those records into the frozen vocabulary rather than silently remap them.
  const accepted = original ? [...boundaries, 'operation'] : boundaries;
  assert(accepted.includes(g.primary_boundary), `${g.id}:boundary`);
  assert(Array.isArray(g.secondary_boundaries) && g.secondary_boundaries.every(b => accepted.includes(b)), g.id);
  assert(typeof g.reason === 'string' && g.reason.length > 10, g.id);
  assert.equal(g.verdict === 'PASS', g.primary_boundary === 'none', `${g.id}:boundary/verdict`);
  if (g.verdict === 'PASS') assert.equal(g.severity, 'NONE', g.id);
}
const workers = {};
const requestedWorkers = process.argv.slice(2);
const workerNames = requestedWorkers.length ? requestedWorkers : ['oma', 'osa', 'facility', 'consumer'];
assert(workerNames.every(w => ['oma', 'osa', 'facility', 'consumer'].includes(w)));
for (const worker of workerNames) {
  const corpus = read(`${prefix}-${worker}-corpus.json`);
  const ids = corpus.journeys.flatMap(j => j.turns.map(t => t.id)).concat(corpus.companions.map(c => c.id));
  assert.equal(new Set(ids).size, ids.length);
  const rawBytes = gunzipSync(fs.readFileSync(`${prefix}-raw/piq-first-contact-${worker}.json.gz`));
  assert.equal(sha(rawBytes), integrity.workers[worker].raw_sha256);
  const raw = JSON.parse(rawBytes);
  assert.equal(raw.stable, true, `${worker}:runtime/fixture stability`);
  assert.equal(raw.final.ready, true, `${worker}:exact-ID integrity`);
  assert.equal(raw.physical_executor_attempts, 0);
  assert.equal(raw.blocked_external_attempts, 0);
  assert.equal(raw.final.records.length, raw.captures.length);
  assert.equal(new Set(raw.captures.map(c => c.attempt.request_id)).size, raw.captures.length);
  for (const capture of raw.captures) {
    const final = raw.final.records.find(r => r.attempt_id === capture.attempt.attempt_id);
    assert(final, 'Missing exact attempt reconciliation');
    assert(['saved_correlated', 'rejected_correlated', 'durable_trace_recovered'].includes(final.classification));
  }
  const actualSetupIds = raw.captures.filter(c => !c.scored).map(c => c.attempt.attempt_id).sort();
  const a = read(`${prefix}-${worker}-grader-a.json`), b = read(`${prefix}-${worker}-grader-b.json`);
  for (const grader of [a, b]) {
    assert.equal(grader.grades.length, ids.length);
    assert.deepEqual([...grader.grades.map(g => g.id)].sort(), [...ids].sort());
    grader.grades.forEach(g => validateGrade(g, true));
    assert.equal(new Set(grader.reviewed_setup_attempts).size, seal.counts[worker].setup_turns);
    assert.deepEqual([...grader.reviewed_setup_attempts].sort(), actualSetupIds);
  }
  const selection = read(`${prefix}-${worker}-adjudication-selection.json`);
  const disagreements = ids.filter(id => {
    const x = a.grades.find(g => g.id === id), y = b.grades.find(g => g.id === id);
    return selection.fields.some(k => k === 'secondary_boundaries'
      ? JSON.stringify([...new Set(x[k])].sort()) !== JSON.stringify([...new Set(y[k])].sort())
      : x[k] !== y[k]);
  });
  assert.deepEqual([...selection.disagreements].sort(), disagreements.sort());
  assert(selection.fields.includes('secondary_boundaries'), 'Full causal-boundary adjudication required');
  assert(selection.agreed_sample.length >= Math.ceil((ids.length - disagreements.length) * .2));
  const turns = corpus.journeys.flatMap(j => j.turns).concat(corpus.companions);
  for (const field of ['intent', 'dimension', 'safety']) for (const value of new Set(turns.map(t => String(t[field])))) {
    const agreed = turns.filter(t => String(t[field]) === value && !disagreements.includes(t.id));
    assert(agreed.filter(t => selection.agreed_sample.includes(t.id)).length >= Math.ceil(agreed.length * .2), `${worker}:${field}:${value} sample`);
  }
  const adjudication = read(`${prefix}-${worker}-adjudication.json`);
  assert.deepEqual(adjudication.grades.map(g => g.id).sort(), [...selection.selected].sort());
  adjudication.grades.forEach(g => validateGrade(g));
  const adjudicatedSetupIds = adjudication.reviewed_setup_attempts
    || adjudication.summary?.reviewed_setup_attempts
    || adjudication.summary?.setup_review?.reviewed_setup_attempts;
  assert(Array.isArray(adjudicatedSetupIds), 'Missing setup review inventory');
  assert.deepEqual(adjudicatedSetupIds.map(x => typeof x === 'string' ? x : x.attempt_id).sort(), actualSetupIds);
  for (const grader of [a, b]) for (const g of grader.grades) {
    if (!boundaries.includes(g.primary_boundary) || g.secondary_boundaries.some(b => !boundaries.includes(b))) {
      assert(selection.selected.includes(g.id), `${g.id}:unreviewed vocabulary error`);
    }
  }
  // Setup IDs are also checked through the graders' explicit review inventory.
  const reviewed = new Set(a.reviewed_setup_attempts.concat(b.reviewed_setup_attempts));
  for (const finding of adjudication.setup_findings || []) assert(reviewed.has(finding.attempt_id), 'Unknown setup finding');
  const initial = `${prefix}-${worker}-adjudication-initial.json`;
  if (fs.existsSync(initial)) assert.notEqual(sha(fs.readFileSync(initial)), sha(fs.readFileSync(`${prefix}-${worker}-adjudication.json`)), 'Initial adjudication must not masquerade as corrected review');
  workers[worker] = {scored: ids.length, disagreements: disagreements.length, agreed_sample: selection.agreed_sample.length, adjudicated: adjudication.grades.length, setup_reviewed: reviewed.size};
}
console.log(JSON.stringify({status: 'PASS', sealed_files: seal.files.length, workers}, null, 2));
