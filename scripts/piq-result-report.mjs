// Supplementary arithmetic and evidence links only; never assigns grades.
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const prefix = 'artifacts/piq-20261016';
const read = file => JSON.parse(fs.readFileSync(file));
const results = read(`${prefix}-results.json`);
const count = (rows, field) => rows.reduce((out, row) => {
  out[row[field]] = (out[row[field]] || 0) + 1; return out;
}, {});
const percent = (n, d) => d ? Number((n * 100 / d).toFixed(3)) : null;
const primary = results.all.filter(g => g.kind === 'primary');
const out = {
  runtime: results.runtime,
  results_sha256: createHash('sha256').update(fs.readFileSync(`${prefix}-results.json`)).digest('hex'),
  all_scored: {total: results.all.length, verdicts: count(results.all, 'verdict'), severity: count(results.all, 'severity')},
  primary: {total: primary.length, severity: count(primary, 'severity')},
  workers: {},
  p0_occurrences: [],
  failed_primary_secondary_boundaries: {},
  interpretation: 'Primary boundaries are observable-path diagnoses, not demonstrated source-line causes. Secondary memberships overlap and are not a partition.'
};
for (const grade of primary.filter(g => g.verdict !== 'PASS')) {
  for (const boundary of new Set(grade.secondary_boundaries)) {
    out.failed_primary_secondary_boundaries[boundary] = (out.failed_primary_secondary_boundaries[boundary] || 0) + 1;
  }
}
for (const worker of ['oma', 'osa', 'facility', 'consumer']) {
  const a = read(`${prefix}-${worker}-grader-a.json`), b = read(`${prefix}-${worker}-grader-b.json`);
  const adj = read(`${prefix}-${worker}-adjudication.json`);
  const selection = read(`${prefix}-${worker}-adjudication-selection.json`);
  const raw = JSON.parse(gunzipSync(fs.readFileSync(`${prefix}-raw/piq-first-contact-${worker}.json.gz`)));
  const rows = primary.filter(g => g.worker === worker);
  const matching = (g, other) => selection.fields.every(k => k === 'secondary_boundaries'
    ? JSON.stringify([...new Set(g[k])].sort()) === JSON.stringify([...new Set(other[k])].sort())
    : g[k] === other[k]);
  const decisions = {both: 0, a_only: 0, b_only: 0, neither: 0};
  for (const grade of adj.grades) {
    const ma = matching(grade, a.grades.find(g => g.id === grade.id));
    const mb = matching(grade, b.grades.find(g => g.id === grade.id));
    decisions[ma && mb ? 'both' : ma ? 'a_only' : mb ? 'b_only' : 'neither']++;
  }
  out.workers[worker] = {
    verdict_agreement_percent: percent(a.grades.filter(g => b.grades.find(h => h.id === g.id).verdict === g.verdict).length, a.grades.length),
    severity_agreement_percent: percent(a.grades.filter(g => b.grades.find(h => h.id === g.id).severity === g.severity).length, a.grades.length),
    full_selection_field_agreement_percent: percent(selection.all - selection.disagreements.length, selection.all),
    adjudicated_decisions: decisions,
    failure_boundaries: count(rows.filter(g => g.verdict !== 'PASS'), 'primary_boundary'),
    primary_severity: count(rows, 'severity')
  };
  const findings = results.all.filter(g => g.worker === worker && g.severity === 'P0')
    .map(g => ({kind: g.kind, id: g.id, reason: g.reason, primary_boundary: g.primary_boundary, capture: raw.captures.find(c => c.scored && c.turn_id === g.id)}))
    .concat(results.setup_findings.filter(g => g.worker === worker && g.severity === 'P0')
      .map(g => ({kind: 'setup', id: g.attempt_id, reason: g.reason, primary_boundary: null, capture: raw.captures.find(c => c.attempt.attempt_id === g.attempt_id)})));
  for (const finding of findings) {
    const c = finding.capture;
    assert(c, 'Missing P0 raw capture');
    out.p0_occurrences.push({
      worker, kind: finding.kind, id: finding.id, reason: finding.reason,
      primary_boundary: finding.primary_boundary,
      request_id: c.attempt.request_id, attempt_id: c.attempt.attempt_id,
      trace_id: c.attempt.trace_id, user_request: c.utterance, actual_answer: c.response?.answer ?? null,
      execution_status: c.response?.execution?.status ?? null,
      current_turn_execution: c.response?.execution?.current_turn_execution ?? null,
      raw_artifact: `${prefix}-raw/piq-first-contact-${worker}.json.gz`,
      execution_limitation: 'No physical execution or external communications occurred. Pending-state and wording findings remain safety failures.'
    });
  }
}
assert.equal(new Set(out.p0_occurrences.map(x => x.attempt_id)).size, out.p0_occurrences.length);
fs.writeFileSync(`${prefix}-analysis.json`, JSON.stringify(out, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({all_scored: out.all_scored, primary: out.primary, p0_occurrences: out.p0_occurrences.length}, null, 2));
