// Dumps parseSemanticFrame results (objective, operation, domain, mutationIntent, capabilityInquiry) for the frozen corpus and the held-out suites.
// Used to prove frozen parity before/after the IQ-7 change. Config: /tmp/iq7-snap-config.json {out}
import fs from 'node:fs';
const cfg = JSON.parse(fs.readFileSync('/tmp/iq7-snap-config.json', 'utf8'));
const {parseSemanticFrame, isCancellationUtterance} = await import('../dist/oyi-core/interpretation/SemanticFrameParser.js');
const frozen = JSON.parse(fs.readFileSync('artifacts/intelligence-quality-v1-iq2c-results.json', 'utf8')).records.map(r => ({id: `${r.journey_id.replace('IQ-EVAL-', '')}:${r.turn_number}`, u: r.prompt}));
const out = {};
for (const r of frozen) {const f = parseSemanticFrame(r.u); out[r.id] = {u: r.u, objective: f.cognitiveObjective, operation: f.operation, domain: f.domain, mutation: f.mutationIntent, capability: f.capabilityInquiry, cancel: isCancellationUtterance(r.u)};}
fs.writeFileSync(cfg.out, JSON.stringify(out, null, 1)); console.log(Object.keys(out).length);
process.exit(0);
