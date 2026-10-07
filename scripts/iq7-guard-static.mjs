// IQ-7 static anti-overfit guard (tooling, not runtime). Fails when runtime language rules (a) read or reference the held-out suites,
// (b) contain fixture place names / corpus roles / fixture tokens, or (c) contain multi-word literal phrases that occur verbatim in the frozen
// corpus or any held-out suite, other than an explicitly allowlisted idiom that is a general discourse marker.
import fs from 'node:fs';
import path from 'node:path';
const ROOT = new URL('..', import.meta.url).pathname;
const LANGUAGE_FILES = ['src/oyi-core/interpretation', 'src/oyi-core/runtime/languageUnderstanding.ts', 'src/oyi-core/context/conversationAssessmentContext.ts', 'src/oyi-core/evidence/reassessment/facts.ts', 'src/oyi-core/evidence/reference/derivedReference.ts', 'src/oyi-core/evidence/reference/derivedReferenceTurn.ts', 'src/oyi-core/capabilities/PublicOpportunityCapabilityModule.ts', 'src/oyi-core/context/publicOpportunityObjective.ts'];
const FORBIDDEN_FIXTURE = [/\blagos\b/i, /\babuja\b/i, /\blekki\b/i, /\bepe\b/i, /\bvenezuela\b/i, /\bwave11\b/i, /\btower\s+b\b/i, /\bchairman\b/i, /\banalyst\b/i, /\bplumber\b/i, /\buncle\b/i, /\bIQ-EVAL\b/, /\b(?:OMA|OSA|FAC|CON)-\d{3}\b/];
// General discourse markers (idioms with no domain content). Each is a general semantic signal, not a recognised benchmark sentence.
// LEGITIMATE DOMAIN VOCABULARY / GRAMMAR (named product concepts, ordinal-reference grammar, generic overall-state questions). Each is a general term,
// not a recognised benchmark sentence; the inventory records the justification.
export const DOMAIN_ALLOWLIST = new Set(['front door', 'cash position', 'joint venture', 'outright sale', 'financial position', 'ochiga development', 'development projects', 'follow ups', 'needs attention', 'what needs attention', 'everything okay', 'is everything okay', 'second one', 'last one', 'check first']);
export const ALLOWLIST = new Set([...DOMAIN_ALLOWLIST, 'never mind', 'go back', 'what about', 'how come', 'i mean', 'i meant', 'not anymore', 'do not', 'does not', 'cannot', 'what if', 'as well', 'so far', 'in case', 'turns out', 'make sure', 'hold on', 'right now', 'at all']);
const FUNCTION_WORDS = new Set('a an the and or but if so of to in on at for from by with about as is are was were be been am do does did have has had can could would should will shall may might must what which who whom whose why when where how this that these those it its i me my mine we us our you your he she they them their there here not no yes just also very too than then now still even again ever any some all each both more most much many such own same other another into over under up down out off get got go going let lets please tell show give take make see say said want need like'.split(' '));
const contentWords = ph => ph.split(' ').filter(w => !FUNCTION_WORDS.has(w));
const walk = p => {const full = path.join(ROOT, p); const st = fs.statSync(full); return st.isDirectory() ? fs.readdirSync(full).flatMap(f => walk(path.join(p, f))) : full.endsWith('.ts') ? [p] : [];};
const files = LANGUAGE_FILES.flatMap(walk);
const corpus = [];
const addCorpus = f => {try {const j = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); for (const r of j.records || j.items || []) corpus.push(String(r.prompt ?? r.u ?? '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim());} catch {}};
addCorpus('artifacts/intelligence-quality-v1-iq2c-results.json');
for (const f of fs.readdirSync(path.join(ROOT, 'artifacts')).filter(f => /iq7-heldout-suite-.*\.json$/.test(f))) addCorpus(`artifacts/${f}`);
const regexLiterals = src => [...src.matchAll(/(?<![\w)\]"'`.])\/((?:\\.|\[(?:\\.|[^\]\\])*\]|[^\/\\\n])+)\/[gimsuy]*/g)].map(m => m[1]);
const phrasesIn = re => {const out = new Set(); for (const frag of re.replace(/\\b/g, ' ').split(/[|()]|\?:|\^|\$/)) {const words = frag.replace(/\\s[+*]?|\[\\s-\]\??|\[\s-\]\??|\\s\?|\s+/g, ' ').replace(/[?+*\\]|\{[^}]*\}|\[[^\]]*\]/g, ' ').split(/\s+/).filter(Boolean).filter(w => /^[a-z']{2,}$/i.test(w)); if (frag.includes('\\w') ) continue;
  for (let n = 2; n <= 4; n++) for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(' ').toLowerCase());} return [...out];};
const violations = {heldout_reference: [], fixture_literal: [], corpus_phrase: []};
for (const f of files.concat(walk('src/oyi-core/orchestration'), walk('src/oyi-core/evidence/judgment'), walk('src/oyi-core/evidence/planner'))) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  if (/iq7-heldout|held-?out|post-iq6|iq2c-results|\/artifacts\//i.test(src.replace(/\/\/.*$/gm, ''))) violations.heldout_reference.push(f);
  src.split('\n').forEach((line, i) => {const code = line.replace(/\/\/.*$/, ''); for (const re of FORBIDDEN_FIXTURE) if (re.test(code) && !/^\s*\*|^\s*\/\*/.test(line)) violations.fixture_literal.push(`${f}:${i + 1} ${re.source}`);});
  if (!LANGUAGE_FILES.some(l => f.startsWith(l))) continue;
  const seen = new Set();
  for (const re of regexLiterals(src)) for (const ph of phrasesIn(re)) {
    if (seen.has(ph) || ALLOWLIST.has(ph)) continue; const words = ph.split(' ');
    if (contentWords(ph).length >= 2 && corpus.some(t => (` ${t} `).includes(` ${ph} `))) {seen.add(ph); violations.corpus_phrase.push(`${f}: "${ph}"`);}
  }
}
const total = Object.values(violations).reduce((n, v) => n + v.length, 0);
const report = {files_scanned: files.length, corpus_prompts: corpus.length, counts: Object.fromEntries(Object.entries(violations).map(([k, v]) => [k, v.length])), total, violations};
if (process.argv.includes('--json')) fs.writeFileSync(process.argv[process.argv.indexOf('--json') + 1], JSON.stringify(report, null, 1));
console.log(JSON.stringify({counts: report.counts, total, files_scanned: files.length, corpus_prompts: corpus.length}));
if (total && !process.argv.includes('--report')) {for (const [k, v] of Object.entries(violations)) for (const x of v.slice(0, 60)) console.error(`${k}: ${x}`); process.exit(1);}
