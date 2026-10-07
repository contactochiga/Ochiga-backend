// IQ-7 phrase-rule inventory: classifies every regex-literal language rule in the runtime language files BEFORE (912fa85) and AFTER (working tree).
// Categories: FIXTURE_SPECIFIC, CORPUS_VERBATIM (multi-word literal found verbatim in the frozen corpus or a held-out suite and not allowlisted),
// LEGITIMATE_DOMAIN_TERM (allowlisted product/ordinal/overall-state vocabulary), GENERAL_SEMANTIC_TOKEN (everything else). Writes the overfit audit.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const ROOT = new URL('..', import.meta.url).pathname;
const BASE = '912fa850ede01e5c42f331bc7c096fa9610956ff';
const FILES = ['src/oyi-core/interpretation/SemanticFrameParser.ts', 'src/oyi-core/interpretation/semanticObjective.ts', 'src/oyi-core/interpretation/domainVocabulary.ts', 'src/oyi-core/interpretation/publicOpportunitySignals.ts', 'src/oyi-core/interpretation/conversationIntentRouting.ts', 'src/oyi-core/interpretation/followUpResolver.ts', 'src/oyi-core/interpretation/goalIntentParser.ts', 'src/oyi-core/interpretation/communicationIntentParser.ts', 'src/oyi-core/runtime/languageUnderstanding.ts', 'src/oyi-core/context/conversationAssessmentContext.ts', 'src/oyi-core/evidence/reassessment/facts.ts', 'src/oyi-core/evidence/reference/derivedReference.ts', 'src/oyi-core/evidence/reference/derivedReferenceTurn.ts', 'src/oyi-core/capabilities/PublicOpportunityCapabilityModule.ts', 'src/oyi-core/context/publicOpportunityObjective.ts'];
const FORBIDDEN = [/\blagos\b/i, /\babuja\b/i, /\blekki\b/i, /\bepe\b/i, /\bvenezuela\b/i, /\bwave11\b/i, /\btower\s+b\b/i, /\bchairman\b/i, /\banalyst\b/i, /\bplumber\b/i, /\buncle\b/i];
const guardSrc = fs.readFileSync(path.join(ROOT, 'scripts/iq7-guard-static.mjs'), 'utf8');
const DOMAIN = new Set([...guardSrc.match(/DOMAIN_ALLOWLIST = new Set\(\[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]));
const DISCOURSE = new Set([...guardSrc.match(/export const ALLOWLIST = new Set\(\[\.\.\.DOMAIN_ALLOWLIST, ([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]));
const FUNCTION_WORDS = new Set(guardSrc.match(/FUNCTION_WORDS = new Set\('([^']+)'/)[1].split(' '));
const corpus = [];
for (const f of ['artifacts/intelligence-quality-v1-iq2c-results.json', ...fs.readdirSync(path.join(ROOT, 'artifacts')).filter(f => /iq7-heldout-suite-.*\.json$/.test(f)).map(f => `artifacts/${f}`)]) { try { const j = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); for (const r of j.records || j.items || []) corpus.push(String(r.prompt ?? r.u ?? '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()); } catch {} }
const regexLiterals = src => [...src.matchAll(/(?<![\w)\]"'`.])\/((?:\\.|\[(?:\\.|[^\]\\])*\]|[^\/\\\n])+)\/[gimsuy]*/g)].map(m => ({src: m[1], line: src.slice(0, m.index).split('\n').length}));
const phrases = re => {const out = new Set(); for (const frag of re.replace(/\\b/g, ' ').split(/[|()]|\?:|\^|\$/)) {const w = frag.replace(/\\s[+*]?|\[\\s-\]\??|\s+/g, ' ').replace(/[?+*\\]|\{[^}]*\}|\[[^\]]*\]/g, ' ').split(/\s+/).filter(x => /^[a-z']{2,}$/i.test(x)); for (let n = 2; n <= 4; n++) for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' ').toLowerCase());} return [...out];};
const classify = (re) => {
  if (FORBIDDEN.some(f => f.test(re))) return 'FIXTURE_SPECIFIC';
  const hits = phrases(re).filter(p => p.split(' ').filter(w => !FUNCTION_WORDS.has(w)).length >= 2 && corpus.some(t => ` ${t} `.includes(` ${p} `)));
  if (hits.length && hits.every(p => DOMAIN.has(p))) return 'LEGITIMATE_DOMAIN_TERM';
  if (hits.length && hits.every(p => DOMAIN.has(p) || DISCOURSE.has(p))) return 'GENERAL_SEMANTIC_TOKEN';
  if (hits.length) return 'CORPUS_VERBATIM';
  return 'GENERAL_SEMANTIC_TOKEN';
};
const read = (ref, f) => { try { return ref ? execFileSync('git', ['show', `${ref}:${f}`], {cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}) : fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { return ''; } };
const scan = ref => FILES.flatMap(f => regexLiterals(read(ref, f)).map(r => ({file: f, line: r.line, category: classify(r.src), source: r.src.slice(0, 140)})));
const before = scan(BASE), after = scan(null);
const count = rs => rs.reduce((a, r) => (a[r.category] = (a[r.category] || 0) + 1, a), {});
const key = r => `${r.file}|${r.source}`; const afterKeys = new Set(after.map(key)), beforeKeys = new Set(before.map(key));
const flagged = c => c === 'FIXTURE_SPECIFIC' || c === 'CORPUS_VERBATIM';
const removed = before.filter(r => flagged(r.category) && !afterKeys.has(key(r)));
const stillFlagged = after.filter(r => flagged(r.category));
const out = {version: 1, status: 'IQ7_OVERFIT_AUDIT', base: BASE, rule_literals: {before: before.length, after: after.length}, before: count(before), after: count(after), flagged_rules_removed_or_rewritten: removed.length, still_flagged: stillFlagged, removed_sample: removed.slice(0, 80),
  classification_note: 'GENERAL_SEMANTIC_TOKEN covers single-word stems and structural patterns; LEGITIMATE_DOMAIN_TERM is the explicit allowlist in scripts/iq7-guard-static.mjs (product concepts, ordinal-reference grammar, generic overall-state questions). UNNECESSARY rules were removed rather than listed.',
  new_runtime_literals_added_for_heldout: 'none by construction: the held-out artifact is not readable by runtime (guard rule 1) and the guard fails on any corpus- or held-out-verbatim multi-word literal outside the allowlist.'};
fs.writeFileSync(path.join(ROOT, 'artifacts/intelligence-quality-v1-iq7-overfit-audit.json'), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({before: out.before, after: out.after, removed: removed.length, still_flagged: stillFlagged.length}));
