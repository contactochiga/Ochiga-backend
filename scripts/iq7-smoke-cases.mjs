import fs from 'node:fs';
const src = fs.readFileSync('scripts/iq2-objective-smoke.mjs', 'utf8');
const m = src.slice(src.indexOf('const cases=['), src.indexOf('];', src.indexOf('const cases=[')) + 2);
const cases = new Function(`${m}; return cases;`)();
const {parseSemanticFrame} = await import('../dist/oyi-core/interpretation/SemanticFrameParser.js');
for (const [p, o] of cases) { const g = parseSemanticFrame(p).cognitiveObjective; if (g !== o) console.log('MISMATCH', JSON.stringify(p), 'expected', o, 'got', g); }
console.log('checked', cases.length); process.exit(0);
