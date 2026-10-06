// IQ-3A benchmark-required source closure tests.
// Real collectors and the real CapabilityService.readEvidence boundary, with
// deterministic query/provider/network fault injection against the local loopback
// fixture's client object (no production target, no real network).
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
assert.equal(process.env.SUPABASE_URL, 'http://127.0.0.1:55421');
const require = createRequire(import.meta.url);
for (const pkg of ['bullmq', 'ioredis']) {const p = require.resolve(pkg); class Inert {on() {return this;} quit() {return Promise.resolve();}} Inert.default = Inert; Inert.Redis = Inert; Inert.Queue = Inert; Inert.Worker = Inert; require.cache[p] = {id: p, filename: p, loaded: true, exports: Inert};}
let fetchImpl = async () => {throw Error('SOURCE_TEST_NETWORK_FORBIDDEN');};
globalThis.fetch = (...a) => fetchImpl(...a);
const {ensureRegistered} = await import('../dist/oyi-core/orchestration/ConversationOrchestrator.js');
const {capabilityRegistry} = await import('../dist/oyi-core/capabilities/CapabilityRegistry.js');
const {capabilityService} = await import('../dist/oyi-core/capabilities/CapabilityService.js');
const {supabaseAdmin: db} = await import('../dist/supabase/supabaseClient.js');
const guard = await import('../dist/oyi-core/evidence/PureReadGuard.js');
const {resolveIntentContract} = await import('../dist/oyi-core/runtime/canonicalTurnResolution.js');
const {corporateKnowledgeOutcome} = await import('../dist/oyi-core/evidence/sources/publicReads.js');
const {HOME_CONTRIBUTORS} = await import('../dist/oyi-core/domains/roomHome/homeContributors.js');
const {ROOM_CONTRIBUTORS} = await import('../dist/oyi-core/domains/roomHome/roomContributors.js');
const {composeAggregateResult, runContributors} = await import('../dist/oyi-core/domains/roomHome/aggregator.js');
ensureRegistered();

const source = fs.readFileSync('scripts/wave11-behavioural-torture-harness.mjs', 'utf8');
const {actorFor, oisContext} = new Function(`${source.slice(source.indexOf('const ids = '), source.indexOf('function expected(prompt)'))};return {actorFor,oisContext};`)();
const context = (surface, role, extra = {}) => {const actor = actorFor(role, surface), ois = oisContext(actor, surface); return {actor, oisContext: ois, input: {surface, message: 'Read authorised source', estate_id: ois.estate_id, home_id: ois.home_id, context: {}, ...extra}, resolvedTurn: {request_id: 'benchmark-source-test', scope: {estate_id: ois.estate_id, home_id: ois.home_id, building_id: null, room_id: null}, semantic_frame: {normalizedText: 'Read source'}, operation: 'list'}, legacyFallback: async () => {throw Error('NO_FALLBACK');}};};
const resident = () => context('consumer', 'resident'), facility = () => context('facility', 'facility_manager'), publicCtx = (threadId) => context('public_corporate', 'public', threadId ? {thread_id: threadId} : {});
const homeA = resident().oisContext.home_id, homeB = actorFor('resident_b', 'consumer').home_id, estate = resident().oisContext.estate_id;
const ROOM = '30000000-0000-4000-8000-0000000000aa', OTHER_ROOM = '30000000-0000-4000-8000-0000000000bb';
const now = () => new Date().toISOString();

// ---- fake query layer --------------------------------------------------------------
const handlers = {}; let queries = [], writes = [], delay = 0;
const run = q => new Promise((resolve, reject) => setTimeout(() => {
  const h = handlers[q.table];
  try {Promise.resolve(h ? h(q) : {data: [], error: null}).then(resolve, reject);} catch (error) {reject(error);}
}, delay));
const matches = (rows, q) => rows.filter(r => q.filters.every(([op, k, v]) => op === 'eq' ? r[k] === v : op === 'in' ? v.includes(r[k]) : op === 'is' ? r[k] === v : true));
db.from = table => {
  const q = {table, filters: [], limit: null, single: false}; queries.push(q);
  const b = {
    select() {return b;}, order() {return b;}, or() {return b;}, neq() {return b;}, lte() {return b;}, not() {return b;},
    eq(k, v) {q.filters.push(['eq', k, v]); return b;}, in(k, v) {q.filters.push(['in', k, v]); return b;}, gte(k, v) {q.filters.push(['gte', k, v]); return b;}, is(k, v) {q.filters.push(['is', k, v]); return b;},
    limit(n) {q.limit = n; return b;},
    maybeSingle() {q.single = true; return run(q).then(r => ({...r, data: Array.isArray(r.data) ? r.data[0] || null : r.data}));},
    insert() {writes.push(`${table}.insert`); return b;}, update() {writes.push(`${table}.update`); return b;}, upsert() {writes.push(`${table}.upsert`); return b;}, delete() {writes.push(`${table}.delete`); return b;},
    then(resolve, reject) {return run(q).then(resolve, reject);},
  };
  return b;
};
db.rpc = () => {writes.push('rpc'); return Promise.resolve({data: null, error: null});};
const reset = () => {for (const k of Object.keys(handlers)) delete handlers[k]; queries = []; writes = []; delay = 0; fetchImpl = async () => {throw Error('SOURCE_TEST_NETWORK_FORBIDDEN');};};
const table = (name, rows, {error = null, limit = true} = {}) => {handlers[name] = q => error ? {data: null, error} : {data: matches(rows(), q).slice(0, limit && q.limit ? q.limit : undefined), error: null};};
const results = [];
const check = async (id, fn) => {reset(); try {await fn(); results.push({id, status: 'PASS'});} catch (error) {error.message = `${id}: ${error.message}`; throw error;}};
const read = (key, ctx, ms) => capabilityService.readEvidence(key, ctx, ms);
const notZero = r => {assert.equal(r.zero_proven, false); assert.notEqual(r.status, 'available_zero'); assert.equal(r.record_count, 0);};

let seq = 0;
const dev = (i, o = {}) => ({id: `dev-${++seq}-${i}`, name: `Device ${i}`, home_id: homeA, estate_id: estate, room_id: null, category: 'light', type: 'switch', metadata: {}, is_virtual: false, parent_device_id: null, adapter: null, provider: null, vendor: null, external_id: null, capabilities: null, ...o});

// ================= DEVICES: shared inventory boundary =====================================
for (const key of ['devices.status.read', 'devices.availability.read']) {
  await check(`${key}:complete-below-bound`, async () => {table('devices', () => [dev(1), dev(2)]); const r = await read(key, resident()); assert.equal(r.status, 'available_complete'); assert.equal(r.complete, true); assert.equal(r.record_count, 2); assert.equal(r.truncated, false); assert(r.records.every(x => x.freshness === 'unobservable' && x.truth_class === 'source_record'), 'unobserved device is kept, marked unobservable'); assert.equal(r.freshness, 'unknown');});
  await check(`${key}:proven-zero-registered-devices`, async () => {table('devices', () => []); const r = await read(key, resident()); assert.equal(r.status, 'available_zero'); assert.equal(r.zero_proven, true);});
  await check(`${key}:query-error-object-not-zero`, async () => {table('devices', () => [], {error: {message: 'synthetic'}}); const r = await read(key, resident()); assert.equal(r.status, 'error'); assert.equal(r.error_class, 'source_error'); notZero(r);});
  await check(`${key}:query-throws-not-zero`, async () => {handlers.devices = () => {throw Error('provider down');}; const r = await read(key, resident()); assert.equal(r.status, 'error'); notZero(r);});
  await check(`${key}:state-hydration-failure-not-zero`, async () => {table('devices', () => [dev(1)]); table('device_states', () => [], {error: {message: 'states down'}}); const r = await read(key, resident()); assert.equal(r.status, 'error'); notZero(r);});
  await check(`${key}:truncated-at-row-bound`, async () => {table('devices', () => Array.from({length: 150}, (_, i) => dev(i))); const r = await read(key, resident()); assert.equal(r.status, 'available_partial'); assert.equal(r.truncated, true); assert.equal(r.complete, false); assert.equal(r.zero_proven, false); assert(r.record_count <= 50); assert.equal(queries.find(q => q.table === 'devices').limit, 100);});
  await check(`${key}:cross-home-never-returned`, async () => {table('devices', () => [dev(1, {home_id: homeB, name: 'B distinctive'}), dev(2)]); const r = await read(key, resident()); assert.equal(r.record_count, 1); assert(!JSON.stringify(r).includes('B distinctive')); assert(queries.find(q => q.table === 'devices').filters.some(([, k, v]) => k === 'home_id' && v === homeA));});
  await check(`${key}:other-home-request-denied-before-query`, async () => {const c = resident(); const r = await read(key, {...c, input: {...c.input, home_id: homeB}}); assert.equal(r.status, 'authority_denied'); assert.equal(queries.length, 0);});
  await check(`${key}:facility-home-only-source-not-admitted`, async () => {const r = await read(key, facility()); assert(['authority_denied', 'scope_unsupported'].includes(r.status)); assert.equal(r.record_count, 0); assert.equal(queries.length, 0);});
  await check(`${key}:public-denied`, async () => {const r = await read(key, publicCtx()); assert.equal(r.status, 'authority_denied'); assert.equal(queries.length, 0);});
  await check(`${key}:building-scope-unsupported`, async () => {const c = resident(); c.input.context = {building_id: 'building-a'}; const r = await read(key, c); assert.equal(r.status, 'scope_unsupported'); assert.equal(queries.length, 0);});
  await check(`${key}:exact-object-not-broadened`, async () => {const c = resident(); c.resolvedTurn.target = {canonical_id: 'dev-x', object_type: 'device'}; const r = await read(key, c); assert.equal(r.status, 'scope_unsupported'); assert.equal(queries.length, 0);});
  await check(`${key}:late-result-discarded-timeout`, async () => {table('devices', () => [dev(1)]); delay = 40; const r = await read(key, resident(), 5); assert.equal(r.status, 'timeout'); notZero(r); const snap = JSON.stringify(r); await new Promise(res => setTimeout(res, 120)); assert.equal(JSON.stringify(r), snap);});
  // Room scope: pushed into the query, so a large home cannot hide room devices behind the row limit.
  await check(`${key}:room-scope-pushed-into-query-not-after-limit`, async () => {
    const roomDevices = [dev('r1', {room_id: ROOM}), dev('r2', {room_id: ROOM}), dev('r3', {room_id: ROOM})];
    const noise = Array.from({length: 150}, (_, i) => dev(`n${i}`, {room_id: OTHER_ROOM}));
    table('devices', () => [...noise, ...roomDevices]);
    const c = resident(); c.input.room_id = ROOM; const r = await read(key, c);
    const q = queries.find(x => x.table === 'devices');
    assert(q.filters.some(([, k, v]) => k === 'room_id' && v === ROOM), 'room filter in query');
    assert.equal(r.record_count, 3); assert.equal(r.status, 'available_complete'); assert.equal(r.truncated, false);
  });
  await check(`${key}:room-not-in-home-is-not-zero`, async () => {table('devices', () => []); table('rooms', () => []); const c = resident(); c.input.room_id = ROOM; const r = await read(key, c); assert.equal(r.status, 'scope_insufficient'); notZero(r); assert(queries.some(q => q.table === 'rooms' && q.filters.some(([, k, v]) => k === 'home_id' && v === homeA)));});
  await check(`${key}:empty-room-in-home-is-proven-zero`, async () => {table('devices', () => []); table('rooms', () => [{id: ROOM, home_id: homeA}]); const c = resident(); c.input.room_id = ROOM; const r = await read(key, c); assert.equal(r.status, 'available_zero'); assert.equal(r.zero_proven, true);});
  await check(`${key}:room-membership-query-failure-not-zero`, async () => {table('devices', () => []); table('rooms', () => [], {error: {message: 'rooms down'}}); const c = resident(); c.input.room_id = ROOM; const r = await read(key, c); assert.equal(r.status, 'error'); notZero(r);});
  await check(`${key}:room-name-enrichment-failure-is-degraded-not-complete`, async () => {table('devices', () => [dev(1, {room_id: ROOM})]); table('rooms', () => [], {error: {message: 'names down'}}); const c = resident(); c.input.room_id = ROOM; const r = await read(key, c); assert.equal(r.status, 'available_partial'); assert.equal(r.complete, false); assert.deepEqual(r.degraded_sources.map(d => d.source), ['room_names']); assert.equal(r.degraded_sources[0].mandatory, false);});
  await check(`${key}:stale-telemetry-is-stale-not-current`, async () => {
    const d = dev(1); table('devices', () => [d]);
    table('device_states', () => [{device_id: d.id, status: {online: true}, last_seen: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z'}]);
    const r = await read(key, resident()); assert.equal(r.status, 'stale'); assert.notEqual(r.freshness, 'current'); assert.equal(r.zero_proven, false);
  });
}

// ================= DEVICES: shared history boundary ======================================
const ledgerRow = (i, o = {}) => ({id: `led-${++seq}-${i}`, device_id: 'dev-h', home_id: homeA, estate_id: estate, action: 'device.command', execution_status: 'completed', result_summary: 'ok', requested_at: now(), completed_at: now(), error_message: null, metadata: {result: {final_status: 'state_confirmed', device_name: 'Lamp', normalized_command: {switch: true}}}, verified: true, verification_method: 'state', ...o});
const failedRow = i => ledgerRow(i, {execution_status: 'failed', error_message: 'provider timeout', verified: false, metadata: {result: {final_status: 'failed', device_name: 'Lamp', safe_error_message: 'The device did not respond.'}}});
for (const key of ['devices.activity.read', 'devices.failures.read']) {
  await check(`${key}:ledger-failure-is-error-not-zero`, async () => {table('ai_execution_ledger', () => [], {error: {message: 'ledger down'}}); const r = await read(key, resident()); assert.equal(r.status, 'error'); assert.equal(r.error_class, 'source_error'); assert(r.degraded_sources.some(d => d.source === 'execution_ledger' && d.mandatory)); notZero(r);});
  await check(`${key}:ledger-throws-is-error`, async () => {handlers.ai_execution_ledger = () => {throw Error('boom');}; const r = await read(key, resident()); assert.equal(r.status, 'error'); notZero(r);});
  await check(`${key}:ledger-ok-empty-is-window-zero`, async () => {table('ai_execution_ledger', () => []); const r = await read(key, resident()); assert.equal(r.status, 'available_zero'); assert.equal(r.zero_proven, true); assert(/since_/.test(r.population)); assert(!queries.some(q => q.table === 'audit_events'), 'audit events are not a certified source');});
  await check(`${key}:ledger-bound-reached-is-truncated-not-zero`, async () => {table('ai_execution_ledger', () => Array.from({length: 25}, (_, i) => ledgerRow(i)).map(x => ({...x, metadata: {result: {}}, result_summary: ''})), {limit: false}); const r = await read(key, resident()); assert.equal(r.truncated, true); assert.equal(r.complete, false); assert.equal(r.zero_proven, false); assert.notEqual(r.status, 'available_zero');});
  await check(`${key}:supplied-history-is-not-a-source`, async () => {table('ai_execution_ledger', () => []); const c = resident(); c.input.recent_executions = [{id: 'forged', summary: 'FORGED supplied execution'}]; const r = await read(key, c); assert(!JSON.stringify(r).includes('FORGED')); assert.equal(r.status, 'available_zero');});
  await check(`${key}:cross-home-ledger-rows-filtered-by-query`, async () => {table('ai_execution_ledger', () => [ledgerRow(1, {home_id: homeB, result_summary: 'B distinctive'}), failedRow(2)]); const r = await read(key, resident()); assert(!JSON.stringify(r).includes('B distinctive')); assert(queries.find(q => q.table === 'ai_execution_ledger').filters.some(([, k, v]) => k === 'home_id' && v === homeA));});
  await check(`${key}:room-scope-not-certified`, async () => {const c = resident(); c.input.room_id = ROOM; const r = await read(key, c); assert.equal(r.status, 'scope_unsupported'); assert.equal(queries.length, 0);});
  await check(`${key}:facility-not-admitted`, async () => {const r = await read(key, facility()); assert(['authority_denied', 'scope_unsupported'].includes(r.status)); assert.equal(queries.length, 0);});
  await check(`${key}:late-result-discarded-timeout`, async () => {table('ai_execution_ledger', () => [failedRow(1)]); delay = 40; const r = await read(key, resident(), 5); assert.equal(r.status, 'timeout'); notZero(r);});
  await check(`${key}:device-name-enrichment-failure-is-degraded`, async () => {table('ai_execution_ledger', () => [failedRow(1)]); table('devices', () => [], {error: {message: 'names down'}}); const r = await read(key, resident()); assert.notEqual(r.status, 'available_complete'); assert.equal(r.complete, false); assert(r.degraded_sources.some(d => d.source === 'execution_device_names' && !d.mandatory));});
}
await check('devices.failures.read:selects-failures-only', async () => {table('ai_execution_ledger', () => [ledgerRow(1), failedRow(2)]); const all = await read('devices.activity.read', resident()); const failed = await read('devices.failures.read', resident()); assert(failed.record_count <= all.record_count); assert(failed.record_count >= 1); assert(failed.records.every(x => /fail|error/i.test(JSON.stringify(x.payload.fact.value) + x.payload.fact.statement)));});

await check('device-observed-value:evidence-exposes-availability-and-freshness-only', async () => {
  // Basis for classifying "observed value" evidence (lock position, temperature, power) as a missing capability:
  // no certified device record carries a physical observed value.
  const d = dev('obs'); table('devices', () => [d]); table('device_states', () => [{device_id: d.id, status: {online: true, switch_1: true, temperature: 31, lock_state: 'locked'}, last_seen: now(), updated_at: now()}]);
  const r = await read('devices.status.read', resident()); assert.equal(r.record_count, 1);
  const allowed = new Set(['availability', 'online', 'category', 'type', 'is_virtual', 'parent_device_id', 'parent_device_name', 'device_family', 'room_name', 'provider_health', 'freshness', 'age_ms']);
  assert.deepEqual(Object.keys(r.records[0].payload.fact.value).filter(k => !allowed.has(k)), []);
  const text = JSON.stringify(r); assert(!/temperature|lock_state|switch_1|"locked"/.test(text), 'no observed physical value in evidence');
});
await check('devices.activity.read:facility-estate-device-history-has-no-safe-source', async () => {
  for (const key of ['devices.status.read', 'devices.availability.read', 'devices.activity.read', 'devices.failures.read']) {const r = await read(key, facility()); assert(['authority_denied', 'scope_unsupported'].includes(r.status), `${key}: ${r.status}`); assert.equal(queries.length, 0);}
});

// ================= FACILITY CAMERAS =======================================================
const camera = (i, o = {}) => ({id: `cam-${i}`, estate_id: estate, home_id: null, privacy_scope: 'facility', metadata: {}, name: `Camera ${i}`, location: 'Gate', edge_node_id: null, nvr_id: null, channel: 1, ai_enabled: false, runtime_observations: null, ...o});
const cameraTables = (rows, {registryError = null, stateError = null} = {}) => {
  handlers.facility_cameras = q => q.filters.some(([op]) => op === 'in') ? (stateError ? {data: null, error: stateError} : {data: matches(rows(), q), error: null}) : (registryError ? {data: null, error: registryError} : {data: matches(rows(), q).slice(0, q.limit || undefined), error: null});
};
const K = 'facility.cameras.read';
await check(`${K}:unknown-state-is-unobservable-never-offline`, async () => {cameraTables(() => [camera(1)]); const r = await read(K, facility()); assert.equal(r.status, 'available_complete'); assert.equal(r.record_count, 1); const rec = r.records[0]; assert.equal(rec.freshness, 'unobservable'); assert.equal(rec.payload.fact.value.overall, 'unknown'); assert(!/offline/i.test(JSON.stringify(r.records)));});
await check(`${K}:registry-failure-is-error-not-zero`, async () => {cameraTables(() => [], {registryError: {message: 'down'}}); const r = await read(K, facility()); assert.equal(r.status, 'error'); notZero(r);});
await check(`${K}:state-resolution-failure-is-error-not-zero`, async () => {cameraTables(() => [camera(1)], {stateError: {message: 'states down'}}); const r = await read(K, facility()); assert.equal(r.status, 'error'); notZero(r);});
await check(`${K}:zero-accessible-cameras-proven`, async () => {cameraTables(() => []); const r = await read(K, facility()); assert.equal(r.status, 'available_zero'); assert.equal(r.zero_proven, true);});
await check(`${K}:registry-bound-before-access-filter-is-truncated`, async () => {cameraTables(() => Array.from({length: 100}, (_, i) => camera(i, {home_id: homeB, privacy_scope: 'home'}))); const r = await read(K, facility()); assert.equal(r.truncated, true); assert.equal(r.complete, false); assert.equal(r.zero_proven, false); assert.notEqual(r.status, 'available_zero');});
await check(`${K}:home-private-camera-excluded-for-facility`, async () => {cameraTables(() => [camera(1), camera(2, {home_id: homeB, privacy_scope: 'home', name: 'B private cam'})]); const r = await read(K, facility()); assert.equal(r.record_count, 1); assert(!JSON.stringify(r).includes('B private cam'));});
await check(`${K}:consumer-not-admitted`, async () => {const r = await read(K, resident()); assert.equal(r.status, 'authority_denied'); assert.equal(queries.length, 0);});
await check(`${K}:public-not-admitted`, async () => {const r = await read(K, publicCtx()); assert.equal(r.status, 'authority_denied'); assert.equal(queries.length, 0);});
await check(`${K}:building-scope-unsupported`, async () => {const c = facility(); c.input.context = {building_id: 'building-a'}; const r = await read(K, c); assert.equal(r.status, 'scope_unsupported'); assert.equal(queries.length, 0);});
await check(`${K}:home-and-room-scope-unsupported`, async () => {const c = facility(); c.input.home_id = homeA; const r1 = await read(K, {...c, oisContext: {...c.oisContext, home_id: homeA}}); const d = facility(); d.input.room_id = ROOM; const r2 = await read(K, d); assert(['scope_unsupported', 'authority_denied'].includes(r1.status)); assert.equal(r2.status, 'scope_unsupported'); assert.equal(queries.length, 0);});
await check(`${K}:late-result-discarded-timeout`, async () => {cameraTables(() => [camera(1)]); delay = 40; const r = await read(K, facility(), 5); assert.equal(r.status, 'timeout'); notZero(r);});

// ================= SCENES ================================================================
const SC = 'scenes.list.read', scene = (i, o = {}) => ({id: `scene-${i}`, estate_id: estate, home_id: homeA, name: `Scene ${i}`, actions: [], enabled: true, updated_at: now(), ...o});
await check(`${SC}:nonempty-is-partial-in-scope`, async () => {table('consumer_scenes', () => [scene(1), scene(2, {home_id: homeB, name: 'B distinctive'})]); const r = await read(SC, resident()); assert.equal(r.status, 'available_partial'); assert.equal(r.record_count, 1); assert(!JSON.stringify(r).includes('B distinctive'));});
await check(`${SC}:proven-zero`, async () => {table('consumer_scenes', () => []); const r = await read(SC, resident()); assert.equal(r.status, 'available_zero');});
await check(`${SC}:query-failure-is-unavailable-not-zero`, async () => {table('consumer_scenes', () => [], {error: {message: 'down'}}); const r = await read(SC, resident()); assert.equal(r.status, 'unavailable'); notZero(r);});
await check(`${SC}:bound-is-truncated`, async () => {table('consumer_scenes', () => Array.from({length: 60}, (_, i) => scene(i))); const r = await read(SC, resident()); assert.equal(r.truncated, true); assert.equal(r.complete, false);});
await check(`${SC}:facility-and-public-denied`, async () => {const a = await read(SC, facility()), b = await read(SC, publicCtx()); assert.equal(a.status, 'authority_denied'); assert.equal(b.status, 'authority_denied'); assert.equal(queries.length, 0);});
await check(`${SC}:room-scope-unsupported`, async () => {const c = resident(); c.input.room_id = ROOM; const r = await read(SC, c); assert.equal(r.status, 'scope_unsupported'); assert.equal(queries.length, 0);});
await check(`${SC}:late-result-discarded-timeout`, async () => {table('consumer_scenes', () => [scene(1)]); delay = 40; const r = await read(SC, resident(), 5); assert.equal(r.status, 'timeout'); notZero(r);});

// ================= PUBLIC: knowledge, development, opportunity ============================
const PK = 'corporate.partnerships.read';
await check(`${PK}:governed-item-carries-provenance`, async () => {
  const r = await read(PK, publicCtx()); assert.equal(r.status, 'available_complete'); assert.equal(r.record_count, 1);
  const p = r.records[0].payload.provenance;
  for (const k of ['canonical_key', 'domain', 'authority_class', 'audience', 'worker_visibility', 'freshness_class', 'claim_boundary', 'version', 'source_family']) assert(k in p, `provenance.${k}`);
  assert.equal(p.canonical_key, 'backend:corporate-partnerships'); assert.equal(p.audience, 'PUBLIC'); assert(p.worker_visibility.includes('oma'));
  assert.equal(r.records[0].freshness, 'unknown', 'governed is not verified-current');
});
await check(`${PK}:provenance-leaks-no-paths-or-hidden-metadata`, async () => {const r = await read(PK, publicCtx()); const s = JSON.stringify(r); assert(!/sourceFile|sourceRepo|src\/oyi-core|\.ts"|tags/.test(s), 'no filesystem path/internal metadata'); assert(!/INTERNAL_ONLY|INTERNAL_COMMERCIAL/.test(s));});
await check(`${PK}:retrieval-failure-is-error-not-fallback-text`, async () => {const r = await corporateKnowledgeOutcome(PK, 'corporate_partnerships', 'backend:corporate-partnerships', {estate_id: null, building_id: null, home_id: null, room_id: null}, async () => ({retrieval: 'retrieval_failed', text: null, provenance: null})); assert.equal(r.status, 'error'); notZero(r); assert(!/Landowners/.test(JSON.stringify(r)), 'in-code fallback copy is never evidence');});
await check(`${PK}:degraded-index-is-unavailable-not-zero`, async () => {const r = await corporateKnowledgeOutcome(PK, 'corporate_partnerships', 'backend:x', {estate_id: null, building_id: null, home_id: null, room_id: null}, async () => ({retrieval: 'retrieval_degraded', text: null, provenance: null})); assert.equal(r.status, 'unavailable'); notZero(r);});
await check(`${PK}:no-authorised-match-is-distinct-from-failure`, async () => {const r = await corporateKnowledgeOutcome(PK, 'corporate_partnerships', 'backend:x', {estate_id: null, building_id: null, home_id: null, room_id: null}, async () => ({retrieval: 'no_authorised_match', text: null, provenance: null})); assert.equal(r.status, 'available_zero'); assert.equal(r.zero_proven, true);});
await check(`${PK}:internal-item-not-reachable-by-public-key`, async () => {const r = await corporateKnowledgeOutcome(PK, 'corporate_partnerships', 'backend:does-not-exist-or-is-hidden', {estate_id: null, building_id: null, home_id: null, room_id: null}); assert(['unavailable', 'available_zero'].includes(r.status)); assert.equal(r.record_count, 0); assert(!/canonical_key/.test(JSON.stringify(r)));});
await check(`${PK}:consumer-office-facility-denied`, async () => {for (const c of [resident(), facility(), context('office_internal', 'ochiga_staff')]) {const r = await read(PK, c); assert.equal(r.status, 'authority_denied');}});
await check(`${PK}:public-with-home-scope-unsupported`, async () => {const c = publicCtx(); c.input.home_id = homeA; const r = await read(PK, c); assert(['scope_unsupported', 'authority_denied'].includes(r.status));});

const DV = 'corporate.development.read', proj = i => ({name: `Project ${i}`, slug: `p-${i}`, typeLine: 't', location: 'Lagos', status: 'planning', oneLiner: 'x'});
const sanity = (body, ok = true) => async () => ({ok, status: ok ? 200 : 503, json: async () => body});
await check(`${DV}:provider-ok-lists-projects-unknown-freshness`, async () => {fetchImpl = sanity({result: [proj(1), proj(2)]}); const r = await read(DV, publicCtx()); assert.equal(r.status, 'available_complete'); assert.equal(r.record_count, 2); assert(r.records.every(x => x.freshness === 'unknown'));});
await check(`${DV}:empty-listing-is-not-proven-current-zero`, async () => {fetchImpl = sanity({result: []}); const r = await read(DV, publicCtx()); assert.equal(r.zero_proven, false); assert.notEqual(r.status, 'available_zero'); assert.equal(r.record_count, 0);});
await check(`${DV}:http-failure-is-unavailable-not-zero`, async () => {fetchImpl = sanity({}, false); const r = await read(DV, publicCtx()); assert.equal(r.status, 'unavailable'); notZero(r);});
await check(`${DV}:network-failure-is-error-not-zero`, async () => {fetchImpl = async () => {throw Error('ECONNRESET');}; const r = await read(DV, publicCtx()); assert.equal(r.status, 'error'); notZero(r);});
await check(`${DV}:provider-timeout-is-timeout`, async () => {fetchImpl = async () => {const e = new Error('t'); e.name = 'TimeoutError'; throw e;}; const r = await read(DV, publicCtx()); assert.equal(r.status, 'timeout'); notZero(r);});
await check(`${DV}:malformed-body-is-not-an-empty-listing`, async () => {fetchImpl = sanity({unexpected: true}); const r = await read(DV, publicCtx()); assert.equal(r.status, 'unavailable'); notZero(r);});
await check(`${DV}:bound-is-truncated`, async () => {fetchImpl = sanity({result: Array.from({length: 60}, (_, i) => proj(i))}); const r = await read(DV, publicCtx()); assert.equal(r.truncated, true); assert.equal(r.complete, false); assert.equal(r.record_count, 50);});
await check(`${DV}:slow-provider-late-result-discarded`, async () => {fetchImpl = async () => {await new Promise(res => setTimeout(res, 40)); return {ok: true, json: async () => ({result: [proj(1)]})};}; const r = await read(DV, publicCtx(), 5); assert.equal(r.status, 'timeout'); notZero(r);});
await check(`${DV}:ordinary-answer-malformed-body-is-unavailable`, async () => {fetchImpl = sanity({unexpected: true}); const mod = capabilityRegistry.get(DV); const evidence = await mod.collectEvidence(publicCtx()); assert.equal(evidence.length, 0); const out = await mod.buildReadResponse(publicCtx(), evidence); assert.equal(out.status, 'unavailable');});
await check(`${DV}:consumer-facility-office-denied`, async () => {for (const c of [resident(), facility(), context('office_internal', 'ochiga_staff')]) assert.equal((await read(DV, c)).status, 'authority_denied');});

const OP = 'corporate.opportunity.read', pub = publicCtx('50000000-0000-4000-8000-000000000001');
const objective = (o = {}) => ({objective_type: 'development_partnership', known_facts: {location: 'Lagos'}, constraints: [], current_subject: 'Lagos', next_move: null, turns: 1, created_at: now(), updated_at: now(), ...o});
const thread = (o = {}) => [{id: '50000000-0000-4000-8000-000000000001', user_id: pub.actor.id, surface: 'public_corporate', metadata: {public_opportunity_objective: objective()}, ...o}];
await check(`${OP}:own-thread-objective-is-user-assertion`, async () => {table('oyi_conversation_threads', () => thread()); const r = await read(OP, pub); assert.equal(r.status, 'available_complete'); assert.equal(r.record_count, 1); assert.equal(r.records[0].truth_class, 'user_assertion'); assert(r.records[0].confidence <= 0.5);});
await check(`${OP}:no-objective-is-zero`, async () => {table('oyi_conversation_threads', () => thread({metadata: {}})); const r = await read(OP, pub); assert.equal(r.status, 'available_zero');});
await check(`${OP}:expired-objective-is-not-current`, async () => {table('oyi_conversation_threads', () => thread({metadata: {public_opportunity_objective: objective({updated_at: '2020-01-01T00:00:00Z'})}})); const r = await read(OP, pub); assert.equal(r.record_count, 0); assert.equal(r.status, 'available_zero');});
await check(`${OP}:query-failure-is-error-not-zero`, async () => {table('oyi_conversation_threads', () => [], {error: {message: 'down'}}); const r = await read(OP, pub); assert.equal(r.status, 'error'); notZero(r);});
await check(`${OP}:someone-elses-thread-denied-no-content`, async () => {table('oyi_conversation_threads', () => thread({user_id: 'someone-else', metadata: {public_opportunity_objective: objective({known_facts: {secret: 'OTHER CALLER FACT'}})}})); const r = await read(OP, pub); assert.equal(r.status, 'authority_denied'); assert(!JSON.stringify(r).includes('OTHER CALLER FACT'));});
await check(`${OP}:non-public-thread-denied`, async () => {table('oyi_conversation_threads', () => thread({surface: 'consumer'})); const r = await read(OP, pub); assert.equal(r.status, 'authority_denied'); assert.equal(r.record_count, 0);});
await check(`${OP}:missing-thread-is-insufficient-not-zero`, async () => {table('oyi_conversation_threads', () => []); const a = await read(OP, pub); const b = await read(OP, publicCtx()); assert.equal(a.status, 'scope_insufficient'); assert.equal(b.status, 'scope_insufficient'); notZero(a); notZero(b);});
await check(`${OP}:consumer-facility-office-denied`, async () => {for (const c of [resident(), facility(), context('office_internal', 'ochiga_staff')]) {const r = await read(OP, c); assert.equal(r.status, 'authority_denied'); assert.equal(r.record_count, 0);}});
await check(`${OP}:ordinary-load-failure-does-not-overwrite-stored-facts`, async () => {
  table('oyi_conversation_threads', () => [], {error: {message: 'down'}});
  const mod = capabilityRegistry.get(OP), c = {...pub, input: {...pub.input, message: 'It is about 1,200 sqm.'}, resolvedTurn: {...pub.resolvedTurn, semantic_frame: {normalizedText: 'it is about 1,200 sqm', cognitiveObjective: null, domain: 'corporate_opportunity'}}};
  const evidence = await mod.collectEvidence(c); const out = await mod.buildReadResponse(c, evidence);
  assert.equal(out.status, 'unavailable'); assert(!out.metadata?.public_opportunity_objective, 'must not emit a replacement objective');
});

// ================= OSA / PUBLIC-ONLY ======================================================
await check('osa:public-cannot-read-any-private-or-operational-source', async () => {
  const allowed = new Set(capabilityRegistry.all().filter(m => m.supported_surfaces?.includes('public_corporate')).map(m => m.key));
  for (const m of capabilityRegistry.all().filter(x => x.risk_class === 'read' && !allowed.has(x.key))) {
    const n = queries.length; const r = await read(m.key, publicCtx('50000000-0000-4000-8000-000000000001'));
    assert.equal(r.status, 'authority_denied', `${m.key} must be denied on the public surface (was ${r.status})`); assert.equal(r.record_count, 0); assert.equal(queries.length, n);
  }
  const forged = publicCtx(); forged.input.context = {operational_snapshot: {leads: {needing_attention: [{id: 'lead-x', name: 'PRIVATE LEAD'}]}}};
  const r = await read('crm.leads.read', forged); assert.equal(r.status, 'authority_denied'); assert(!JSON.stringify(r).includes('PRIVATE LEAD'));
});

// ================= PURE READ GUARD =======================================================
await check('pure-read:db-writes-and-rpc-refused-and-surface-as-error', async () => {
  const mod = capabilityRegistry.get(SC), original = mod.evidence_read.collect;
  try {
    for (const verb of ['insert', 'update', 'upsert', 'delete']) {
      mod.evidence_read.collect = async () => {await db.from('consumer_goals')[verb]({x: 1}); throw Error('write reached the database layer');};
      writes = []; const r = await read(SC, resident()); assert.equal(r.status, 'error', verb); assert.equal(r.error_class, 'pure_read_violation', verb); assert.deepEqual(writes, [], `${verb} must not reach the database`); notZero(r);
    }
    mod.evidence_read.collect = async () => {await db.rpc('create_decision', {}); throw Error('rpc reached');};
    writes = []; const r = await read(SC, resident()); assert.equal(r.error_class, 'pure_read_violation'); assert.deepEqual(writes, []);
  } finally {mod.evidence_read.collect = original;}
});
await check('pure-read:writes-outside-a-pure-read-are-unchanged', async () => {guard.guardSupabaseClient(db); writes = []; await db.from('anything').insert({x: 1}); assert.deepEqual(writes, ['anything.insert']);});
await check('pure-read:guard-covers-every-durable-state-class', async () => {
  // Every durable Oyi state write is a database write; each category must be refused.
  for (const t of ['consumer_goals', 'oyi_decisions', 'oyi_recommendations', 'oyi_awareness', 'oyi_workflows', 'oyi_communications', 'oyi_action_proposals', 'device_commands', 'oyi_memory', 'oyi_learning_candidates']) {
    const out = await guard.runPureRead(db, async () => {await db.from(t).insert({}); return 'wrote';}); assert.equal(out.value, null); assert(out.violations.includes(`${t}.insert`), t);
  }
});
await check('pure-read:persisting-intelligence-collectors-not-planner-eligible', async () => {
  for (const key of ['anomalies.read', 'predictions.read', 'forecasts.read', 'recommendations.read']) {
    const m = capabilityRegistry.get(key); assert(!m.evidence_read, `${key} must not be opted in`);
    const n = queries.length; const r = await read(key, resident()); assert(['scope_unsupported', 'authority_denied'].includes(r.status)); assert.equal(r.record_count, 0); assert.equal(queries.length, n); assert.deepEqual(writes, []);
  }
  const text = fs.readFileSync('src/oyi-core/domains/intelligence/intelligenceCapabilities.ts', 'utf8'); assert(/persist: true/.test(text), 'documents the intrinsic persistence these collectors keep');
});
await check('pure-read:certified-adapter-modules-satisfy-import-allowlist', async () => {
  const dir = 'src/oyi-core/evidence/sources'; const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts')); assert(files.length >= 4);
  for (const f of files) assert.deepEqual(guard.pureReadImportViolations(fs.readFileSync(path.join(dir, f), 'utf8')), [], f);
  // Shared module files (e.g. the Office module file) legitimately import writers for answer/action paths, so
  // each certified collector's OWN body is scanned for writer/dispatcher calls; loaders it calls are covered by
  // the runtime guard, and adapters under evidence/sources by the import allowlist above.
  const forbiddenCall = /\b(requestOfficeHandoff|persist\w*|upsert|\.insert\(|\.update\(|\.delete\(|propose\w*|dispatch\w*|sendEmail|execute\w*|emit\w*|createGoal|createWorkflow|writeMemory|promote\w*)\b/;
  for (const m of capabilityRegistry.all().filter(x => x.evidence_read)) {
    for (const body of [m.collectEvidence.toString(), m.evidence_read.collect.toString()].map(t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/ .*$/gm, ''))) assert(!forbiddenCall.test(body), `${m.key}: certified collector body calls a writer/dispatcher: ${(body.match(forbiddenCall)||[])[0]} ... ${body.slice(Math.max(0,body.search(forbiddenCall)-80), body.search(forbiddenCall)+80)}`);
  }
  assert.notDeepEqual(guard.pureReadImportViolations('import { x } from "../context/goalProposal";\n'), [], 'a writer import is rejected');
  assert.notDeepEqual(guard.pureReadImportViolations('import { x } from "../ingress/officeHandoffBridge";\n'), [], 'a communication dispatcher import is rejected');
});

// ================= AGGREGATE COMPLETENESS (Home/Room contributors) =========================
const contract = resolveIntentContract({surface: 'consumer', message: 'how is my home', estate_id: estate, home_id: homeA}, null, {objectType: null, objectId: null, objectName: null});
const aggCtx = (extra = {}) => ({input: {...resident().input, ...extra}, oisContext: resident().oisContext, contract, scope: {estate_id: estate, home_id: homeA, room_id: extra.room_id || null}, operation: 'summary'});
const homeDevices = HOME_CONTRIBUTORS.find(c => c.domain === 'devices'), roomDevices = ROOM_CONTRIBUTORS.find(c => c.domain === 'devices');
await check('home.summary.read:devices-contributor-failure-is-unavailable-not-no-devices', async () => {
  table('devices', () => [], {error: {message: 'down'}}); const s = await homeDevices.contribute(aggCtx());
  assert.equal(s.status, 'unavailable'); assert(!/No registered devices/.test(s.summary)); assert.equal(s.coverage, 'none');
  const agg = composeAggregateResult({scopeType: 'home', scopeRef: {estate_id: estate, home_id: homeA, room_id: null, label: 'home'}, operation: 'summary', contributors: [s], summaryText: ''});
  assert.equal(agg.overall_state, 'partial'); assert.notEqual(agg.overall_state, 'stable'); assert.equal(agg.status, 'unavailable');
});
await check('home.summary.read:empty-registry-is-a-real-empty-contributor', async () => {table('devices', () => []); const s = await homeDevices.contribute(aggCtx()); assert.equal(s.status, 'empty'); assert(/No registered devices/.test(s.summary));});
const observed = list => table('device_states', () => list.map(d => ({device_id: d.id, status: {online: true}, last_seen: now(), updated_at: now()})));
await check('home.summary.read:truncated-inventory-says-so', async () => {const list = Array.from({length: 120}, (_, i) => dev(i)); table('devices', () => list); observed(list); const s = await homeDevices.contribute(aggCtx()); assert(/more may exist/.test(s.summary));});
await check('home.summary.read:aggregate-with-unavailable-contributor-is-never-stable', async () => {
  table('devices', () => [], {error: {message: 'down'}});
  const ctx = aggCtx(); const run = await runContributors([homeDevices, {domain: 'maintenance', supports: () => true, contribute: async () => ({domain: 'maintenance', status: 'empty', summary: 'none', facts: [], attention_items: [], severity: 'none', freshness: 'unknown', object_refs: [], coverage: 'full', source_health: 'healthy'})}], ctx);
  const agg = composeAggregateResult({scopeType: 'home', scopeRef: {estate_id: estate, home_id: homeA, room_id: null, label: 'home'}, operation: 'summary', contributors: run.contributors, summaryText: ''});
  assert.equal(agg.status, 'partial'); assert.equal(agg.overall_state, 'partial'); assert.equal(agg.coverage.unavailable, 1);
});
await check('room.status.read:devices-room-not-in-home-is-unavailable-not-empty-room', async () => {table('devices', () => []); table('rooms', () => []); const s = await roomDevices.contribute(aggCtx({room_id: ROOM})); assert.equal(s.status, 'unavailable'); assert(!/No devices registered in this room/.test(s.summary));});
await check('room.status.read:empty-room-in-home-is-empty', async () => {table('devices', () => []); table('rooms', () => [{id: ROOM, home_id: homeA}]); const s = await roomDevices.contribute(aggCtx({room_id: ROOM})); assert.equal(s.status, 'empty');});
await check('room.status.read:room-devices-found-in-large-home', async () => {const list = [...Array.from({length: 150}, (_, i) => dev(`n${i}`, {room_id: OTHER_ROOM})), dev('mine', {room_id: ROOM})]; table('devices', () => list); observed(list); const s = await roomDevices.contribute(aggCtx({room_id: ROOM})); assert.equal(s.facts.length, 1);});
await check('home.activity.read:ledger-failure-is-unavailable-contributor', async () => {
  table('ai_execution_ledger', () => [], {error: {message: 'down'}});
  const mod = capabilityRegistry.get('home.activity.read'); const ev = await mod.collectEvidence({...resident(), input: {...resident().input, message: 'what happened today'}}); const out = await mod.buildReadResponse({...resident(), input: {...resident().input, message: 'what happened today'}}, ev);
  const text = JSON.stringify(out); assert(!/No recent device changes/.test(text), 'ledger failure must not read as no recent device changes'); assert(/could not confirm current device data/i.test(text), text.slice(0, 500)); assert.equal(out.metadata.overall_state, 'partial'); assert(out.metadata.coverage.unavailable >= 1);
});

// ================= ORDINARY-PATH false-zero regressions ===================================
await check('devices.activity.read:ordinary-answer-ledger-failure-is-not-no-changes', async () => {
  table('ai_execution_ledger', () => [], {error: {message: 'down'}}); const mod = capabilityRegistry.get('devices.activity.read'); const c = resident();
  const ev = await mod.collectEvidence(c); const out = await mod.buildReadResponse(c, ev); assert.equal(out.status, 'unavailable'); assert(!/do not see meaningful/.test(out.answer)); assert(/could not load/i.test(out.answer));
});
await check('devices.failures.read:ordinary-answer-ledger-failure-is-not-no-failures', async () => {
  table('ai_execution_ledger', () => [], {error: {message: 'down'}}); const mod = capabilityRegistry.get('devices.failures.read'); const c = resident();
  const ev = await mod.collectEvidence(c); const out = await mod.buildReadResponse(c, ev); assert.equal(out.status, 'unavailable'); assert(!/do not see confirmed failures/.test(out.answer));
});
await check('devices.diagnosis.read:ordinary-answer-ledger-failure-is-unavailable', async () => {
  table('ai_execution_ledger', () => [], {error: {message: 'down'}}); const mod = capabilityRegistry.get('devices.diagnosis.read'); const c = resident();
  const ev = await mod.collectEvidence(c); const out = await mod.buildReadResponse(c, ev); assert.equal(out.status, 'unavailable');
});
await check('devices.status.read:ordinary-answer-query-failure-is-could-not-load', async () => {
  table('devices', () => [], {error: {message: 'down'}}); const mod = capabilityRegistry.get('devices.status.read'); const c = {...resident(), resolvedTurn: {...resident().resolvedTurn, semantic_frame: {normalizedText: 'which devices are offline', domain: 'devices', operation: 'device.status'}}};
  const ev = await mod.collectEvidence(c); const out = await mod.buildReadResponse(c, ev); assert(/could not load/i.test(out.answer)); assert(!/do not see devices that are confirmed offline/.test(out.answer));
});
await check('facility.cameras.read:ordinary-answer-failure-cannot-call-any-camera-offline', async () => {
  cameraTables(() => [], {registryError: {message: 'down'}}); const mod = capabilityRegistry.get(K); const c = facility(); const ev = await mod.collectEvidence(c); const out = await mod.buildReadResponse(c, ev);
  assert.equal(out.status, 'unavailable');
});

// ================= SURFACE x SCOPE MATRIX (every certified collector) ======================
const CLASSES = {
  consumer_home: ctx => ctx, consumer_room: ctx => {ctx.input.room_id = ROOM; return ctx;},
  facility_estate: ctx => ctx, facility_building: ctx => {ctx.input.context = {building_id: 'b'}; return ctx;}, facility_home: ctx => {ctx.input.home_id = homeA; ctx.oisContext = {...ctx.oisContext, home_id: homeA}; return ctx;}, facility_room: ctx => {ctx.input.room_id = ROOM; return ctx;},
  office_permissioned_snapshot: ctx => ctx, public_thread: ctx => ctx, public_corporate: ctx => ctx,
};
const surfaceFor = cls => cls.startsWith('consumer') ? ['consumer', 'resident'] : cls.startsWith('facility') ? ['facility', 'facility_manager'] : cls.startsWith('office') ? ['office_internal', 'ochiga_staff'] : ['public_corporate', 'public'];
const matrix = [];
await check('matrix:every-certified-collector-admits-only-its-declared-surface-scope-classes', async () => {
  fetchImpl = sanity({result: []});
  for (const m of capabilityRegistry.all().filter(x => x.evidence_read)) {
    for (const cls of Object.keys(CLASSES)) {
      reset(); fetchImpl = sanity({result: []});
      const [surface, role] = surfaceFor(cls); const ctx = CLASSES[cls](context(surface, role, cls === 'public_thread' ? {thread_id: '50000000-0000-4000-8000-000000000001'} : {}));
      ctx.actor.permissions = [...new Set([...(ctx.actor.permissions || []), ...(m.permission_requirements || [])])];
      table('oyi_conversation_threads', () => thread()); table('rooms', () => [{id: ROOM, home_id: homeA}]);
      const sc = m.evidence_read.scopes; const declared = cls === 'public_thread' ? (sc.includes('public_thread') || sc.includes('public_corporate')) : sc.includes(cls); const r = await read(m.key, ctx);
      const admitted = !['scope_unsupported', 'authority_denied', 'scope_insufficient'].includes(r.status);
      if (!declared) {assert(!admitted, `${m.key} must NOT admit ${cls} (was ${r.status})`); assert.equal(r.record_count, 0); }
      matrix.push({capability_key: m.key, scope_class: cls, declared, status: r.status, admitted});
      if (declared && cls !== 'public_thread') assert(!['scope_unsupported'].includes(r.status), `${m.key} declared ${cls} but rejected it as unsupported`);
    }
  }
});
await check('matrix:no-certified-collector-admits-a-wider-class-than-declared-for-exact-objects', async () => {
  for (const m of capabilityRegistry.all().filter(x => x.evidence_read)) {
    reset(); const [surface, role] = m.evidence_read.scopes[0].startsWith('office') ? ['office_internal', 'ochiga_staff'] : m.evidence_read.scopes[0].startsWith('public') ? ['public_corporate', 'public'] : m.evidence_read.scopes[0].startsWith('facility') ? ['facility', 'facility_manager'] : ['consumer', 'resident'];
    const c = context(surface, role); c.resolvedTurn.target = {canonical_id: 'exact-1', object_type: 'x'}; c.actor.permissions = [...new Set([...(c.actor.permissions || []), ...(m.permission_requirements || [])])];
    const r = await read(m.key, c); assert(['scope_unsupported', 'authority_denied'].includes(r.status), `${m.key}: ${r.status}`); assert.equal(queries.length, 0);
  }
});

const counts = results.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {});
fs.writeFileSync('artifacts/intelligence-quality-v1-iq3a-benchmark-source-tests.json', JSON.stringify({status: 'PASS', test_mode: 'Real collectors and CapabilityService.readEvidence with deterministic query/provider/network fault injection on the local loopback fixture client; no production target; no real network', counts, results, surface_scope_matrix: matrix}, null, 2) + '\n');
console.log(JSON.stringify({status: 'PASS', tests: results.length, counts, matrix_rows: matrix.length}));
