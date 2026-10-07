// IQ-7 held-out evaluation (parser/state level). Runs the CANONICAL understanding path only: parseSemanticFrame, assessmentSubjectDomains,
// nextConversationAssessment, classifyUpdate. Usage (inside the fixture runner): node scripts/iq1-local-run.mjs script <out> scripts/iq7/eval-heldout.mjs
// Env/inputs: reads /tmp/iq7-eval-config.json {suite:"artifact path", split:"dev|test|all", out:"/tmp/..json"}
import fs from 'node:fs';
const cfg = JSON.parse(fs.readFileSync('/tmp/iq7-eval-config.json', 'utf8'));
const suite = JSON.parse(fs.readFileSync(cfg.suite, 'utf8'));
const {parseSemanticFrame} = await import('../dist/oyi-core/interpretation/SemanticFrameParser.js');
const ctxmod = await import('../dist/oyi-core/context/conversationAssessmentContext.js');
const {classifyUpdate} = await import('../dist/oyi-core/evidence/reassessment/facts.js');
const NOW = Date.parse('2026-10-08T10:00:00Z'), iso = ms => new Date(ms).toISOString();
const prior = c => c ? ({objective: c.objective, surface: c.surface, domain: c.domains.length === 1 ? c.domains[0] : null, subject_domains: c.domains, subject_label: c.label || null, question: 'seed', status: 'assessment_pending', suspended: false, available_evidence_domains: [], created_at: iso(NOW - 60000), updated_at: iso(NOW - 60000), expires_at: iso(NOW + 20 * 60000)}) : null;
const subjectClass = (domains, surface, hasPrev) => domains.length === 0 ? (hasPrev ? 'inherit' : 'default') : domains.length > 1 && JSON.stringify([...domains].sort()) === JSON.stringify([...ctxmod.defaultAssessmentSubject(surface)].sort()) ? 'default' : domains;
const items = suite.items.filter(i => cfg.split === 'all' || i.split === cfg.split);
const rows = items.map(it => {
  const ctx = suite.contexts[it.c] || null, prev = prior(ctx), frame = parseSemanticFrame(it.u, {activeAssessment: Boolean(prev)}), got = {};
  const next = ctxmod.nextConversationAssessment(prev, frame, it.s, NOW);
  const retained = Boolean(prev && next && next.created_at === prev.created_at && !next.suspended);
  got.objective = frame.cognitiveObjective;
  const exp = it.o;
  const objOk = exp === null ? frame.cognitiveObjective === null : exp === 'inherit' ? ((frame.cognitiveObjective === null && retained) || (prev && frame.cognitiveObjective === prev.objective)) : frame.cognitiveObjective === exp;
  const checks = {objective: Boolean(objOk)};
  if (it.sub) {const dom = ctxmod.assessmentSubjectDomains(frame, it.s); const sc = subjectClass(dom, it.s, Boolean(prev)); got.subject = sc;
    checks.subject = Array.isArray(sc) ? sc.includes(it.sub) : (sc === it.sub || (it.sub === 'inherit' && sc === 'inherit') || (it.sub === 'default' && (sc === 'default' || sc === 'inherit' && !prev)));
    if (it.sub === 'inherit' && Array.isArray(sc)) checks.subject = false;}
  if (it.f) {const t = classifyUpdate(it.u, []).type; got.fact = t; checks.fact = t === it.f;}
  if (it.fu && prev) {const cls = next === null ? 'not_followup' : retained ? 'continue' : 'new_topic'; got.followup = cls; checks.followup = cls === it.fu;}
  const act = it.act || 'none';
  if (it.act || it.nr) {
    const mut = frame.mutationIntent, cap = frame.capabilityInquiry, canc = frame.operation === 'cancel'; got.action = {mutation: mut, capability: cap, cancel: canc};
    if (act === 'cancel') {checks.action = canc && !mut; checks.safety = !mut;} else if (act === 'no_mutation') {checks.action = !mut; checks.safety = !mut;}
    else if (act === 'mutation') checks.action = mut; else if (act === 'capability') {checks.action = cap && frame.cognitiveObjective === null;} else checks.action = !mut && !cap;
    if (it.nr?.includes('capability_discovery')) checks.not_capability = !cap;
    if (it.nr?.includes('assessment')) checks.not_assessment = frame.cognitiveObjective === null;
  }
  return {id: it.id, split: it.split, s: it.s, st: it.st, c: it.c, u: it.u, expected: {o: it.o, sub: it.sub, f: it.f, fu: it.fu, act: it.act}, got, checks, pass: Object.values(checks).every(Boolean)};
});
const rate = (rs, k) => {const x = rs.filter(r => k in r.checks); return {n: x.length, correct: x.filter(r => r.checks[k]).length, rate: x.length ? +(x.filter(r => r.checks[k]).length / x.length).toFixed(3) : null};};
const dims = ['objective', 'subject', 'fact', 'followup', 'action', 'safety', 'not_capability', 'not_assessment'];
const summary = Object.fromEntries(dims.map(k => [k, rate(rows, k)]));
const byStratum = Object.fromEntries(['near', 'distant', 'colloquial', 'elliptical', 'adversarial'].map(s => [s, Object.fromEntries(dims.map(k => [k, rate(rows.filter(r => r.st === s), k)]))]));
const bySurface = Object.fromEntries(['office_internal', 'public_corporate', 'facility', 'consumer'].map(s => [s, Object.fromEntries(['objective', 'subject', 'fact', 'followup', 'action'].map(k => [k, rate(rows.filter(r => r.s === s), k)]))]));
const falsePositiveObjective = (() => {const x = rows.filter(r => r.expected.o === null && 'objective' in r.checks); return {n: x.length, false_positive: x.filter(r => r.got.objective !== null).length};})();
const mutationFalsePositive = (() => {const x = rows.filter(r => r.expected.act && ['cancel', 'no_mutation', 'none', 'capability'].includes(r.expected.act)); return {n: x.length, false_positive: x.filter(r => r.got.action?.mutation).length};})();
const out = {split: cfg.split, items: rows.length, summary, by_stratum: byStratum, by_surface: bySurface, false_positive_objective: falsePositiveObjective, action_intent_false_positive: mutationFalsePositive, capability_false_routing: {n: rows.filter(r => 'not_capability' in r.checks).length, failures: rows.filter(r => r.checks.not_capability === false).map(r => r.id)},
  safety_failures: rows.filter(r => r.checks.safety === false).map(r => ({id: r.id, u: r.u})), failures: rows.filter(r => !r.pass).map(r => ({id: r.id, st: r.st, u: r.u, expected: r.expected, got: r.got, failed: Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => k)}))};
fs.writeFileSync(cfg.out, JSON.stringify(out, null, 1));
console.log(JSON.stringify({split: cfg.split, items: rows.length, summary: Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, `${v.correct}/${v.n}=${v.rate}`])), fp_obj: falsePositiveObjective, fp_mut: mutationFalsePositive, cap_false: out.capability_false_routing.failures.length, safety_fail: out.safety_failures.length}));
process.exit(0);
