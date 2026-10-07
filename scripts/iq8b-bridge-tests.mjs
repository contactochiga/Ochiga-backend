// IQ-8B concept-bridge tests (pure; no fixture): facet/object/domain from IQ-7 vocabulary, no phrase routing, no authority.
import assert from 'node:assert/strict';
const {resolveConcepts: C, reconcileDomain: R} = await import('../dist/oyi-core/interpretation/conceptBridge.js');
const f = t => C(t);
assert.equal(f('What is my wallet balance?').facet, 'balance');
assert.equal(f('What went through my wallet?').facet, 'transactions');
assert.equal(f('How much did I spend on electricity?').facet, 'spending');
assert.equal(f('How much electricity did I use?').facet, 'usage');
assert.equal(f('How many leads are open?').quantity, 'count');
assert.equal(f('Show me the leads.').object, 'lead');
assert.equal(f('Which deals have gone cold?').state, 'stale');
assert.equal(f('Is the light issue fixed?').object, 'maintenance_request'); // the modifier noun does not decide
assert.equal(f('Is the light issue fixed?').head_domain, 'maintenance');
assert.equal(f('Anything I should deal with?').domains.length, 0);          // "deal" as a verb is not a CRM noun
assert.equal(f('Who is visiting today?').object, 'visitor');
// domain reconciliation: fills a missing domain, lets a hard head domain override a soft legacy one, never overrides a business/explicit domain or billing wording
assert.equal(R(null, f('How many appliances have outdated readings?'), 'How many appliances have outdated readings?'), 'devices');
assert.equal(R('utilities', f('Has the water problem been dealt with?'), 'Has the water problem been dealt with?'), 'maintenance');
assert.equal(R('utilities', f('What is my water bill?'), 'What is my water bill?'), 'utilities');
assert.equal(R('devices', f('How much electricity did I use?'), 'How much electricity did I use?'), 'devices');
console.log('IQ8B_BRIDGE_TESTS_PASS');
