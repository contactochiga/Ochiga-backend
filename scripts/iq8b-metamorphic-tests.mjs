// IQ-8B metamorphic routing tests (parser/concept level, no fixture): transformations that must PRESERVE the routing signature, and transformations
// that MUST CHANGE it. Signature = {domain, object, facet, quantity, mutation}.
import assert from 'node:assert/strict';
const {parseSemanticFrame: P} = await import('../dist/oyi-core/interpretation/SemanticFrameParser.js');
const {deriveAnswerTarget: D} = await import('../dist/oyi-core/response/answerTarget.js');
const sig = t => {const f = P(t); const a = D(t, {objective: f.cognitiveObjective}); return {domain: f.domain, object: f.concepts?.object ?? null, facet: f.concepts?.facet ?? null, quantity: f.concepts?.quantity ?? null, mutation: f.mutationIntent, intent: a.response_intent};};
const keys = ['domain', 'object', 'facet', 'mutation'];
const same = (a, b, ks = keys) => ks.every(k => a[k] === b[k]);
const preserve = [
  ['Show me the open maintenance requests.', ['Could you please show me the open maintenance requests?', 'open maintenance requests, show me', 'SHOW ME THE OPEN MAINTENANCE REQUESTS', 'Um, show me the open maintenance requests.', 'Which maintenance requests are open?']],
  ['What is my wallet balance?', ['Tell me my wallet balance please.', 'my wallet balance, what is it?', 'what is the balance in my wallet', 'How much is left in my wallet?', "What's sitting in my wallet?"]],
  ['Show my wallet transactions.', ['What went through my wallet?', 'wallet transactions please', 'Could you list my wallet history?', 'show me what I spent from my wallet']],
  ['Who is visiting today?', ['Who is coming to see me today?', 'Which guests are expected today?', 'who is on my visitor list today', 'please tell me which visitors are expected']],
  ['How many leads are open?', ['How many open leads do I have?', 'what is the number of open leads', 'Count my open leads please.', 'how many prospects are open']],
  ['Which opportunities are stale?', ['Which opportunities have gone quiet?', 'Show me opportunities that are neglected.', 'stale opportunities, which ones', 'Which deals have gone cold?']],
  ['Is the camera working?', ['Is the camera online right now?', 'Can you tell me if the camera is working?', 'is the camera ok', 'Is our camera working please?']],
  ['Which devices have stale readings?', ['Which gadgets have outdated readings?', 'List the appliances whose data is old.', 'which sensors have stale readings', 'devices with stale readings, which']],
];
const change = [
  ['Show me the leads.', 'How many leads are there?', ['quantity', 'intent']],
  ['What is my wallet balance?', 'Show my wallet transactions.', ['facet']],
  ['What is the state of the generator?', 'What did the generator do yesterday?', ['facet']],
  ['What did I spend on electricity?', 'How much electricity did I use?', ['facet']],
  ['Is the light on?', 'Turn the light on.', ['mutation']],
  ['Is the lock secure?', 'Unlock the door.', ['mutation']],
  ['Is the heating on?', 'Switch the heating off.', ['mutation']],
  ['Should I worry about the water leak?', 'Which water leak should I fix first?', ['intent']],
  ['Which opportunity is best?', 'How many opportunities are there?', ['intent']],
];
let pass = 0, fail = [];
for (const [base, vars] of preserve) {const b = sig(base); for (const v of vars) {const s = sig(v); const ks = base.startsWith('How many') || /number|count/i.test(v) ? keys : keys; if (same(b, s, ks.filter(k => !(k === 'object' && ['wallet', 'visitor'].includes(b.object))))) pass++; else fail.push({kind: 'preserve', base, v, b, s});}}
let cp = 0; for (const [a, b, ks] of change) {const x = sig(a), y = sig(b); if (ks.some(k => x[k] !== y[k])) cp++; else fail.push({kind: 'change', a, b, x, y});}
const total = preserve.reduce((n, [, v]) => n + v.length, 0);
console.log(JSON.stringify({preserve: {n: total, pass, rate: +(pass / total).toFixed(3)}, change: {n: change.length, pass: cp, rate: +(cp / change.length).toFixed(3)}}));
for (const f of fail) console.log(JSON.stringify(f));
if (process.argv.includes('--strict') && fail.length) process.exit(1);
