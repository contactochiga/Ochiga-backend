// IQ-8B routing-stack audit (tooling): lists every lexical routing rule that interprets raw wording AFTER IQ-7 parsing and classifies it.
// Classes: REQUIRED_DOMAIN_VOCABULARY | LEGITIMATE_OPERATION_TOKEN | DUPLICATE_SEMANTIC_INTERPRETATION | PHRASE_SHAPED_ROUTING | SURFACE_SPECIFIC_NECESSITY
import fs from 'node:fs'; import path from 'node:path';
const R = new URL('..', import.meta.url).pathname;
const files = ['src/oyi-core/capabilities/ReadCapabilityModules.ts', 'src/oyi-core/capabilities/OfficeCorporateCapabilityModules.ts', 'src/oyi-core/capabilities/PublicOpportunityCapabilityModule.ts', 'src/oyi-core/capabilities/OfficeActionCapabilityModules.ts', 'src/oyi-core/capabilities/DeviceActionCapabilityModules.ts'];
const rows = [];
const classify = (expr) => {
  const hasRegex = /\/(?:\\.|\[[^\]]*\]|[^\/\n])+\/[gimsuy]*\.test\(/.test(expr);
  const phrase = /\/[^\/\n]*\b[a-z]+(?:\\s\+?|\s)[a-z]+\b[^\/\n]*\//i.test(expr) && hasRegex;
  const surface = /surface|supported_surfaces|office_internal|public_corporate/.test(expr);
  const opOnly = /frame\.operation\s*===/.test(expr);
  const domainOnly = !hasRegex && /frame\.domain\s*===/.test(expr);
  if (domainOnly && !opOnly) return 'REQUIRED_DOMAIN_VOCABULARY';
  if (domainOnly) return 'LEGITIMATE_OPERATION_TOKEN';
  if (surface && !hasRegex) return 'SURFACE_SPECIFIC_NECESSITY';
  if (hasRegex && phrase) return 'PHRASE_SHAPED_ROUTING';
  if (hasRegex) return 'DUPLICATE_SEMANTIC_INTERPRETATION';
  return 'REQUIRED_DOMAIN_VOCABULARY';
};
for (const f of files) {
  const src = fs.readFileSync(R + f, 'utf8').split('\n');
  src.forEach((l, i) => { if (/supports:\s*/.test(l)) { let expr = l; for (let k = 1; k < 4 && !/\),?\s*$|,\s*$/.test(expr.trim()); k++) expr += ' ' + (src[i + k] || ''); rows.push({file: f, line: i + 1, kind: 'capability.supports', cls: classify(expr), excerpt: expr.trim().slice(0, 200)}); } });
}
const ld = fs.readFileSync(R + 'src/oyi-core/runtime/languageUnderstanding.ts', 'utf8').split('\n');
const s0 = ld.findIndex(l => /^function classifyDomain/.test(l)), s1 = ld.findIndex((l, i) => i > s0 && /^}/.test(l));
ld.slice(s0, s1).forEach((l, i) => { if (/if \(\/.+\/i?\.test\(text\)\) return "/.test(l)) rows.push({file: 'src/oyi-core/runtime/languageUnderstanding.ts', line: s0 + i + 1, kind: 'classifyDomain', cls: classify(l), excerpt: l.trim().slice(0, 200)}); });
const tally = rows.reduce((m, r) => (m[`${r.kind}:${r.cls}`] = (m[`${r.kind}:${r.cls}`] || 0) + 1, m), {});
fs.writeFileSync(R + 'artifacts/intelligence-quality-v1-iq8b-routing-audit.json', JSON.stringify({version: 1, note: 'automatic first-pass classification by rule shape; DUPLICATE_SEMANTIC_INTERPRETATION = a regex over raw wording inside a predicate that already has frame.domain / operation / IQ-7 concepts available', counts: tally, rules: rows}, null, 1) + '\n');
console.log(JSON.stringify(tally, null, 1)); console.log(rows.length);
