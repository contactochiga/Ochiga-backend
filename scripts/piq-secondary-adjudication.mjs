// Repair selection coverage only. No grading, runtime or frozen-input changes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const [mode, worker] = process.argv.slice(2);
assert(['oma', 'osa', 'facility', 'consumer'].includes(worker));
const root = `artifacts/piq-20261016-${worker}`;
const read = p => JSON.parse(fs.readFileSync(p));
const sha = x => createHash('sha256').update(x).digest('hex');
const writeNew = (p, x) => fs.writeFileSync(p, JSON.stringify(x, null, 2) + '\n', {flag: 'wx'});
const originalPath = `${root}-adjudication-selection.json`;
if (mode === 'prepare') {
  const original = read(originalPath);
  const a = read(`${root}-grader-a.json`), b = read(`${root}-grader-b.json`);
  const corpus = read(`${root}-corpus.json`);
  const turns = corpus.journeys.flatMap(j => j.turns).concat(corpus.companions);
  const fields = [...original.fields, 'secondary_boundaries'];
  const equal = (a, b, k) => k === 'secondary_boundaries'
    ? JSON.stringify([...new Set(a[k])].sort()) === JSON.stringify([...new Set(b[k])].sort())
    : a[k] === b[k];
  const disagreements = turns.filter(t => fields.some(k => !equal(a.grades.find(g => g.id === t.id), b.grades.find(g => g.id === t.id), k))).map(t => t.id);
  const agreed = turns.filter(t => !disagreements.includes(t.id));
  const sample = new Set(agreed.filter(t => original.selected.includes(t.id)).map(t => t.id));
  for (const group of ['intent', 'dimension', 'safety']) for (const value of new Set(turns.map(t => String(t[group])))) {
    const eligible = agreed.filter(t => String(t[group]) === value).map(t => t.id).sort((a,b) => sha(a).localeCompare(sha(b)));
    for (const id of eligible.slice(0, Math.ceil(eligible.length * .2))) sample.add(id);
  }
  const selected = [...new Set([...disagreements, ...sample])];
  assert(original.selected.every(id => selected.includes(id)));
  const supplemental = selected.filter(id => !original.selected.includes(id));
  const expanded = {...original, fields, disagreements, agreed_count: agreed.length,
    agreed_sample: [...sample], selected, agreement_rate: agreed.length / turns.length,
    supplemental, selection_correction: 'Includes order-insensitive secondary-boundary disagreements required by unchanged original protocol; no grade or expectation changed.',
    original_selection_sha256: sha(fs.readFileSync(originalPath))};
  fs.writeFileSync(`${root}-adjudication-selection-before-secondary-review.json`, fs.readFileSync(originalPath), {flag:'wx'});
  writeNew(`${root}-adjudication-secondary-selection.json`, expanded);
  console.log(JSON.stringify({worker, original_selected: original.selected.length, expanded_selected: selected.length, supplemental}, null, 2));
} else if (mode === 'finalize') {
  const original = read(originalPath), expanded = read(`${root}-adjudication-secondary-selection.json`);
  assert.equal(sha(fs.readFileSync(originalPath)), expanded.original_selection_sha256);
  const currentPath = `${root}-adjudication.json`;
  const current = read(currentPath), supplemental = read(`${root}-adjudication-secondary-review.json`);
  assert.deepEqual(current.grades.map(g=>g.id).sort(), [...original.selected].sort());
  assert.deepEqual(supplemental.grades.map(g=>g.id).sort(), [...expanded.supplemental].sort());
  assert.equal(new Set(supplemental.grades.map(g=>g.id)).size, expanded.supplemental.length);
  const reviewedSetup = current.reviewed_setup_attempts || current.summary?.reviewed_setup_attempts || current.summary?.setup_review?.reviewed_setup_attempts;
  const combined = {...current, grades: [...current.grades, ...supplemental.grades],
    setup_findings: [...(current.setup_findings || []), ...(supplemental.new_setup_findings || [])],
    summary: {selected_count: expanded.selected.length, reviewed_setup_attempts: reviewedSetup,
      initial_review: current.summary, supplemental_review: supplemental.summary,
      note: 'Initial-review counts describe the original subset. Final union covers expanded selection, including every secondary-boundary disagreement.'},
    supplemental_access_declaration: supplemental.access_declaration};
  fs.writeFileSync(`${root}-adjudication-before-secondary-review.json`, fs.readFileSync(currentPath), {flag:'wx'});
  // Mechanical materialization of independently authored union for the frozen scorer.
  fs.writeFileSync(currentPath, JSON.stringify(combined, null, 2) + '\n');
  fs.writeFileSync(originalPath, JSON.stringify(expanded, null, 2) + '\n');
  console.log(JSON.stringify({worker, selected: combined.grades.length, status:'materialized_independent_union'}));
} else throw Error('Expected prepare or finalize');
