import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
process.env.SUPABASE_URL='http://127.0.0.1:1';process.env.SUPABASE_SERVICE_ROLE_KEY='local-fixture-only';
process.env.APP_JWT_SECRET='slice14b-fixture-only';
let rows=[],reads=0,rpcs=[],signals=[],rpcResult,consumerMode=false;
const stub=(file,exports)=>{const id=require.resolve(file);require.cache[id]={id,filename:id,loaded:true,exports}};
const client={from(table){if(!consumerMode)assert.equal(table,'edge_nodes','authority may only read Edge identity/observation');reads++;let estate,selected;
  const q={select(s){selected=s;return q},eq(k,v){if(k==='estate_id')estate=v;return q},in(){return q},order(){return q},limit(){return q},then(resolve,reject){return Promise.resolve({data:(table==='edge_nodes'?rows:[]).filter(r=>r.estate_id===estate).map(r=>selected==='*'?structuredClone(r):Object.fromEntries(selected.split(',').map(k=>[k,r[k]]))),error:null}).then(resolve,reject)}};return q},
  async rpc(name,args){rpcs.push({name,args});return rpcResult}};
stub('../dist/supabase/supabaseClient.js',{supabaseAdmin:client});
stub('../dist/core/foundation/index.js',{emitAuditEvent:async()=>{},hasPermission:()=>true});
stub('../dist/core/foundation/audit.js',{emitAuditEvent:async()=>{}});
stub('../dist/realtime/emitSignal.js',{makeBaseSignal:x=>x,emitSignal:x=>signals.push({signal:x}),emitSignalSafely:(x,opts)=>signals.push({signal:x,opts})});
stub('../dist/intelligence-core/index.js',{normalizeIntelligenceEvent:x=>x,publishIntelligenceEvent:async()=>({})});
stub('../dist/services/tuyaRegistrySyncService.js',{getTuyaUidForUser:async()=>null});
const authority=require('../dist/services/edgeCurrentStateAuthority.js');
const edge=require('../dist/routes/edgeDiscovery.js').edgeDiscoveryRouter;
const auth=require('../dist/middleware/edgeToken.js');
const now=Date.now(),iso=n=>new Date(n).toISOString();
function node(age=0,extra={}){return {id:'row',edge_node_id:'edge-a',estate_id:'estate-a',heartbeat_status:'online',last_seen_at:iso(now),
 heartbeat_observed_at:iso(now-age),heartbeat_received_at:iso(now-age+5),heartbeat_observation:{version:1,source:'edge_heartbeat',status:'online',queue_depth:0,error_count:0,sync_status:'synced',runtime_version:'fixture',expected_interval_ms:30000,...extra}}}
let passed=0;async function test(name,fn){await fn();passed++;console.log('PASS '+name)}
await test('fresh healthy and service-degraded reports retain source/components',()=>{
 let state=authority.edgeCurrentState(node(),now);assert.equal(state.connectivity,'healthy');assert.equal(state.freshness,'fresh');assert.equal(state.runtimeVersion,'fixture');
 state=authority.edgeCurrentState(node(0,{queue_depth:3,sync_status:'degraded',error_count:2}),now);assert.equal(state.connectivity,'degraded');assert.equal(state.queueHealth.depth,3);assert.equal(state.syncHealth,'degraded');assert.equal(state.errorState.reportedCount,2);
 assert.equal(authority.edgeCurrentState(node(0,{status:'error'}),now).lastKnownStatus,'error');
});
await test('stale/expired/never observed are knowledge states, not fabricated offline reports',()=>{
 const stale=authority.edgeCurrentState(node(100001),now),expired=authority.edgeCurrentState(node(190001),now);
 assert.equal(stale.freshness,'stale');assert.equal(stale.connectivity,'degraded');assert.equal(expired.connectivity,'unavailable');assert.equal(expired.lastKnownStatus,'online');
 assert.equal(authority.edgeCurrentState({edge_node_id:'never',heartbeat_status:'online',last_seen_at:iso(now)},now).connectivity,'unknown');
 assert.equal(authority.edgeCurrentState(node(0,{status:'unrecognized'}),now).connectivity,'unknown');
});
await test('policy boundaries derived from cadence; custom expectation represented honestly',()=>{
 assert.equal(authority.edgeCurrentState(node(100000),now).freshness,'fresh');assert.equal(authority.edgeCurrentState(node(190000),now).freshness,'stale');
 const state=authority.edgeCurrentState(node(170000,{expected_interval_ms:60000}),now);assert.equal(state.freshness,'fresh');assert.equal(state.policy.expiresMs,370000);assert.match(state.policy.intervalSource,/not_agent_confirmed/);
});
await test('received time is distinct; late receipt and cold restart never freshen source observation',()=>{
 const old=node(3600000);old.heartbeat_received_at=iso(now);const state=authority.edgeCurrentState(old,now);assert.equal(state.freshness,'expired');assert.notEqual(state.observedAt,state.receivedAt);
 assert.deepEqual(authority.edgeCurrentState(JSON.parse(JSON.stringify(old)),now),state);assert.deepEqual(authority.edgeCurrentState(old,now),state);
});
await test('impossible future / malformed stored observation fails closed',()=>{
 assert.equal(authority.edgeCurrentState(node(-60000),now).freshness,'unknown');
 const bad=node();bad.heartbeat_observed_at='bad';assert.equal(authority.edgeCurrentState(bad,now).reason,'invalid_observation');
});
await test('1/10/50/100-node current-state lists each use one bounded projection query; no polling',async()=>{
 global.fetch=()=>{throw Error('read-time network polling forbidden')};
 for(const n of [1,10,50,100]){reads=0;rows=Array.from({length:n},(_,i)=>({...node(3600000),edge_node_id:'edge-'+i}));rows.push({...node(),estate_id:'other'});
 const states=await authority.listEdgeCurrentStates('estate-a');assert.equal(states.length,n);assert.equal(reads,1);assert.ok(states.every(s=>s.freshness==='expired'));}
});
await test('ingestion preserves source ts and uses only transactional RPC with bound identity',async()=>{
 rpcs=[];rpcResult={data:{accepted:true,disposition:'accepted',node:node()},error:null};
 const payload={ts:iso(now-5000),status:'online'};await authority.ingestEdgeHeartbeat({id:'edge-a',siteId:'estate-a'},payload);
 assert.equal(rpcs.length,1);assert.equal(rpcs[0].name,'oyi_ingest_edge_heartbeat');assert.equal(rpcs[0].args.p_heartbeat.ts,payload.ts);assert.equal(rpcs[0].args.p_estate_id,'estate-a');
});
await test('Edge A cannot spoof Edge B/estate and legacy unbound tokens cannot ingest',async()=>{
 rpcs=[];for(const payload of [{site_id:'estate-b'},{estate_id:'estate-b'},{agent_id:'edge-b'},{edge_node_id:'edge-b'}])await assert.rejects(()=>authority.ingestEdgeHeartbeat({id:'edge-a',siteId:'estate-a'},{ts:iso(now),...payload}),/identity/);
 await assert.rejects(()=>authority.ingestEdgeHeartbeat({id:'a',siteId:'b',legacy:true},{ts:iso(now)}),/identity/);assert.equal(rpcs.length,0);
});
await test('missing/invalid/future timestamp rejects before RPC; no receipt-time fallback',async()=>{
 rpcs=[];for(const ts of [undefined,'bad','2026-09-24T10:00:00',iso(Date.now()+60000)])await assert.rejects(()=>authority.ingestEdgeHeartbeat({id:'a',siteId:'b'},{ts}),/observed_at/);assert.equal(rpcs.length,0);
});
const handler=edge.stack.find(l=>l.route?.path==='/edge/agent/heartbeat').route.stack.at(-1).handle;
const req={edgeAgent:{id:'edge-a',siteId:'estate-a'},body:{ts:iso(now),status:'online'}};
const res=()=>({statusCode:200,status(n){this.statusCode=n;return this},json(body){this.body=body;return this}});
await test('duplicate/older/delayed reports never emit false health restoration or camera signals',async()=>{
 for(const data of [{accepted:false,disposition:'duplicate',node:node()},{accepted:false,disposition:'older',node:node()},{accepted:true,disposition:'accepted',node:node(3600000)}]){
  signals=[];rpcResult={data,error:null};const out=res();await handler(req,out);assert.equal(out.statusCode,200);assert.equal(signals.length,0);
 }
});
await test('fresh accepted heartbeat publishes observed-time telemetry, not ambient health transitions',async()=>{
 signals=[];rpcResult={data:{accepted:true,disposition:'accepted',node:node()},error:null};const out=res();await handler(req,out);
 assert.equal(signals.length,1);assert.equal(signals[0].signal.type,'edge.heartbeat');assert.equal(signals[0].signal.timestamp,iso(now));assert.equal(signals[0].opts.skipCanonicalIngress,true);
});
await test('RPC failure is retriable failure, never acknowledged as durable success',async()=>{
 signals=[];rpcResult={data:null,error:{message:'fixture transaction failure'}};const out=res();await handler(req,out);assert.equal(out.statusCode,503);assert.equal(out.body.ok,false);assert.equal(signals.length,0);
});
await test('authenticated middleware denies cross-node and cross-estate tokens',()=>{
 process.env.OYI_EDGE_AGENT_IDENTITIES=JSON.stringify([{token:'fixture',agent_id:'edge-a',site_id:'estate-a'}]);
 for(const body of [{agent_id:'edge-b'},{site_id:'estate-b'}]){const out=res();let next=false;auth.requireEdgeToken({headers:{authorization:'Bearer fixture'},query:{},body},out,()=>next=true);assert.equal(next,false);assert.equal(out.statusCode,401)}
});
await test('authority never touches camera/execution/awareness storage; legacy mirrors cannot override it',()=>{
 const source=readFileSync('src/services/edgeCurrentStateAuthority.ts','utf8');assert.doesNotMatch(source,/facility_cameras|camera_infrastructure|submit.*Signal|executeDeviceCommand/);
 const row=node(3600000);row.heartbeat_status='online';row.last_seen_at=iso(now);assert.equal(authority.projectEdgeNode(row,now).heartbeat_status,'unavailable');
});
await test('Facility presentation and telemetry use expired knowledge, not permanent registry online',async()=>{
 consumerMode=true;rows=[node(3600000)];
 const controller=require('../dist/controllers/facilityInfrastructureController.js');const out=res();
 await controller.getFacilityInfrastructure({user:{id:'fm',role:'facility_manager',estate_id:'estate-a'}},out);
 assert.equal(out.statusCode,200);assert.equal(out.body.edge_nodes[0].status,'unavailable');assert.equal(out.body.edge_nodes[0].current_state.lastKnownStatus,'online');
 assert.ok(JSON.stringify(out.body).includes('heartbeat_expired_telemetry_unavailable'));consumerMode=false;
});
await test('onboarding catalog requires fresh healthy Edge knowledge, not legacy online',async()=>{
 consumerMode=true;
 // Isolate the Edge-readiness gate from optional local provider installation.
 stub('../dist/infrastructure-onboarding/providerRegistry.js',{listInfrastructureProviderManifests:()=>[{key:'onvif',requires_edge:true,implementation:'active',adapter_registered:true}]});
 const {infrastructureProviderCatalog}=require('../dist/infrastructure-onboarding/service.js');
 for(const [row,ready] of [[node(),true],[node(3600000),false],[{...node(),heartbeat_observation:null},false]]){
  rows=[row];const catalog=await infrastructureProviderCatalog({id:'fm',estate_id:'estate-a'});
  const onvif=catalog.find(item=>item.key==='onvif');assert.ok(onvif);
  assert.equal(onvif.readiness,ready?'ready':'needs_edge');
 }
 consumerMode=false;
});
console.log(`Slice14B authority: ${passed} groups passed; no cache, no polling, no camera mutation.`);
