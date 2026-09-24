import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);process.env.SUPABASE_URL='http://127.0.0.1:1';process.env.SUPABASE_SERVICE_ROLE_KEY='fixture';
const db={},queries=[];let rpcCalls=0;
const client={from(table){db[table]??=[];let filters=[],fields='*',write,conflict,action='read',count=Infinity;
 const q={select(v='*'){fields=v;return q},eq(k,v){filters.push(r=>r[k]===v);return q},neq(k,v){filters.push(r=>r[k]!==v);return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},is(k,v){filters.push(r=>(r[k]??null)===v);return q},gt(k,v){filters.push(r=>r[k]>v);return q},lt(k,v){filters.push(r=>r[k]<v);return q},contains(k,v){filters.push(r=>Array.isArray(r[k])&&v.every(x=>r[k].some(y=>typeof x==='object'?Object.entries(x).every(([a,b])=>y[a]===b):x===y)));return q},or(){return q},order(){return q},limit(n){count=n;return q},insert(v){write=v;action='insert';return q},upsert(v,o){write=v;conflict=o?.onConflict;action='upsert';return q},update(v){write=v;action='update';return q},single(){return run(true)},maybeSingle(){return run(true)},then(a,b){return run(false).then(a,b)}};
 async function run(single){queries.push({table,action,fields});let rows=db[table].filter(r=>filters.every(f=>f(r)));
 if(write){if(action==='update')rows.forEach(r=>Object.assign(r,structuredClone(write)));else{rows=[];for(const v of Array.isArray(write)?write:[write]){let row=conflict?db[table].find(r=>r[conflict]===v[conflict]):null;if(row)Object.assign(row,structuredClone(v));else{row={id:randomUUID(),...structuredClone(v)};db[table].push(row)}rows.push(row)}}}
 const output=rows.slice(0,count).map(r=>fields==='*'?structuredClone(r):Object.fromEntries(fields.split(',').map(k=>[k,structuredClone(r[k])])));return{data:single?output[0]||null:output,error:null}}
 return q},async rpc(name,args){rpcCalls++;assert.equal(name,'oyi_accept_camera_health_transition');return{data:{accepted:true},error:null}}};
function stub(path,exports){const id=require.resolve(path);require.cache[id]={id,filename:id,loaded:true,exports}}
stub('../dist/supabase/supabaseClient.js',{supabaseAdmin:client});
stub('../dist/core/foundation/audit.js',{emitAuditEvent:async()=>{}});
const realtime=[];stub('../dist/realtime/emitSignal.js',{makeBaseSignal:x=>x,emitSignalSafely:(s,o)=>{assert.equal(o.skipCanonicalIngress,true);realtime.push(s)}});
const service=require('../dist/modules/cameras/cameraHealthTransition.service.js');
const {submitCanonicalSignal}=require('../dist/oyi-core/ingress/canonicalSignalIngress.js');
const policy=service.CAMERA_TRANSITION_POLICY;
const camera={id:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',estate_id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',home_id:null,privacy_scope:'facility',metadata:{},edge_node_id:null,nvr_id:null,channel:null,ai_enabled:false,runtime_observations:null,health_transition_checkpoint:null};
const rows=[];let num=0;
for(const [prev,next,expected] of [[null,'healthy',null],[null,'degraded','camera.health.degraded'],[null,'unavailable','camera.video.unavailable'],['healthy','degraded','camera.health.degraded'],['degraded','degraded',null],['degraded','unavailable','camera.video.unavailable'],['unavailable','healthy','camera.video.restored'],['degraded','healthy','camera.video.restored'],['unavailable','degraded','camera.health.improved'],['healthy','unknown',null],['unknown','healthy',null]])assert.equal(service.cameraTransitionType(prev,next),expected);
assert.equal(service.cameraTransitionType('unavailable','healthy',false),null);
console.log('PASS transition matrix initialization, expiry, impairment, escalation, full/partial recovery and policy rebaseline');
const prepared=service.prepareCameraTransition(camera,null);assert.equal(prepared.state.overall,'unknown');assert.equal(prepared.evaluation.transition_type,null);
const clock=Date.now(),iso=age=>new Date(clock-age).toISOString();
const node={id:randomUUID(),estate_id:camera.estate_id,edge_node_id:'edge-a',heartbeat_observed_at:iso(1000),heartbeat_received_at:iso(900),heartbeat_observation:{version:1,source:'edge_heartbeat',status:'online',queue_depth:0,sync_status:'synced',error_count:0,expected_interval_ms:30000}};
function observation(kind,source,result,age=1000){return {schema_version:1,observation_id:randomUUID(),camera_id:camera.id,edge_node_id:'edge-a',kind,source,result,observed_at:iso(age),received_at:iso(age-100),details:kind==='frame'&&result==='acquired'?{mime_type:'image/jpeg',size_bytes:4,validation:'bounded_image_signature'}:{}}}
function withEvidence(...obs){return {...camera,edge_node_id:'edge-a',ai_enabled:true,runtime_observations:{version:1,dimensions:Object.fromEntries(obs.map(o=>[o.kind+':'+o.source,{latest:o,...(o.result==='acquired'?{last_success:o}:{})}]))}}}
const freshFrame=observation('frame','ai_snapshot','acquired');
const healthyCamera=withEvidence(freshFrame);
const baseline=service.prepareCameraTransition(healthyCamera,node,clock);
assert.equal(baseline.state.overall,'healthy');assert.equal(baseline.evaluation.transition_type,null);
const checkpoint={overall:'healthy',policy_revision:policy,summary:baseline.evaluation.summary};
for(const failed of [observation('inference','external_detector','failed'),observation('stream','go2rtc_inspection','failed')]){
 const c={...withEvidence(freshFrame,failed),health_transition_checkpoint:checkpoint};
 const p=service.prepareCameraTransition(c,node,clock);assert.equal(p.state.overall,'degraded');assert.equal(p.evaluation.transition_type,'camera.health.degraded');
}
const unscheduledProbe=service.prepareCameraTransition({...withEvidence(freshFrame,observation('reachability','onvif_probe','failed')),health_transition_checkpoint:checkpoint},node,clock);
assert.equal(unscheduledProbe.state.reachability.freshness,'unspecified');assert.equal(unscheduledProbe.evaluation.transition_type,null,'transition layer must not invent a probe TTL or override frozen interpretation');
const failedFrame={...withEvidence(observation('frame','ai_snapshot','failed')),health_transition_checkpoint:checkpoint};
failedFrame.runtime_observations.dimensions['frame:ai_snapshot'].last_success=freshFrame;
assert.equal(service.prepareCameraTransition(failedFrame,node,clock).evaluation.transition_type,'camera.video.unavailable');
const expired=service.prepareCameraTransition({...healthyCamera,health_transition_checkpoint:checkpoint},node,clock+600000);
assert.equal(expired.state.overall,'unknown');assert.equal(expired.evaluation.transition_type,null);
const returned=service.prepareCameraTransition({...healthyCamera,health_transition_checkpoint:{...checkpoint,overall:'unknown'}},node,clock);
assert.equal(returned.evaluation.transition_type,null);
const near=service.prepareCameraTransition(withEvidence(observation('frame','ai_snapshot','acquired',54999)),node,clock);
assert.ok(Date.parse(near.evaluation.valid_until)<=clock+2,'acceptance deadline must precede frame freshness crossing');
const edgeNear=service.prepareCameraTransition(healthyCamera,{...node,heartbeat_observed_at:iso(99999),heartbeat_received_at:iso(99900)},clock);
assert.ok(Date.parse(edgeNear.evaluation.valid_until)<=clock+2,'Edge freshness changes must invalidate evaluations even without a new heartbeat');
const repeated=service.prepareCameraTransition({...healthyCamera,health_transition_checkpoint:checkpoint},node,clock);
assert.equal(repeated.evaluation.transition_type,null);
const replay=structuredClone(healthyCamera);replay.runtime_observations.dimensions['frame:ai_snapshot'].latest.received_at=iso(0);
assert.equal(service.prepareCameraTransition({...replay,health_transition_checkpoint:checkpoint},node,clock).evaluation.transition_type,null);
console.log('PASS frozen interpreter governs frame/inference/control/stream failures, expiry, initialization and freshness deadlines');
for(const count of [1,10,50,100]){db.facility_cameras=Array.from({length:count},(_,i)=>({...camera,id:`fixture-${i}`}));queries.length=0;rpcCalls=0;await service.evaluateCameraTransitions('',count);assert.equal(queries.filter(q=>q.table==='facility_cameras').length,1);assert.equal(rpcCalls,count);assert.ok(queries.every(q=>['facility_cameras','edge_nodes'].includes(q.table)))}
for(const count of [1,10,50,100]){db.edge_nodes=[node];db.facility_cameras=Array.from({length:count},(_,i)=>({...camera,id:`fixture-edge-${i}`,edge_node_id:node.edge_node_id}));queries.length=0;rpcCalls=0;await service.evaluateCameraTransitions('',count);assert.equal(queries.length,2);assert.equal(queries.filter(q=>q.table==='edge_nodes').length,1);assert.equal(rpcCalls,count)}
console.log('PASS 1/10/50/100 bounded evaluation, one camera list/no history/provider reads, one CAS per camera');
db.facility_cameras=[camera];
for(const [previous,current,type] of [['healthy','degraded','camera.health.degraded'],['degraded','unavailable','camera.video.unavailable'],['unavailable','healthy','camera.video.restored']]){
 const row={transition_id:`camera-health:${camera.id}:${++num}`,camera_id:camera.id,estate_id:camera.estate_id,home_id:null,checkpoint_revision:num,previous_state:previous,current_state:current,transition_type:type,policy_revision:policy,evaluated_at:new Date().toISOString(),payload:{summary:prepared.evaluation.summary},delivery_state:'pending',attempt_count:0,updated_at:new Date().toISOString(),lease_until:null};rows.push(row);
 const signal=service.cameraTransitionSignal(row,camera);const envelope=await submitCanonicalSignal(signal);assert.equal(envelope?.receipt.accepted,true);
 assert.equal(await service.cameraTransitionMaterialized(row.transition_id,camera),true,'must prove actual Core signal/awareness/incident persistence');
 assert.equal(db.operational_incidents.length,1);assert.equal(db.operational_incidents[0].status,current==='healthy'?'resolved':'open');
 const before=db.operational_signals.length;await submitCanonicalSignal(signal);assert.equal(db.operational_signals.length,before);
}
assert.ok(db.operational_recommendations.length>0);assert.ok(db.operational_insights.length>0);
console.log('PASS actual canonical ingress: stable signals, awareness, one evolving incident open/open/resolved, recommendations/insights');
db.camera_health_transition_outbox=rows.map(r=>({...r,delivery_state:'materialized'}));
const retry={...rows.at(-1),delivery_state:'pending',lease_until:null};db.camera_health_transition_outbox[2]=retry;
await service.deliverCameraTransitions();assert.equal(retry.delivery_state,'materialized');assert.equal(db.operational_signals.length,3);assert.equal(realtime.length,1);
// Canonical signal-only duplicate is deliberately NOT sufficient acknowledgement.
const otherCamera={...camera,id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'};db.facility_cameras.push(otherCamera);
const incomplete={...rows[0],transition_id:'camera-health:incomplete:1',camera_id:otherCamera.id,checkpoint_revision:4,delivery_state:'pending',lease_until:null};
await submitCanonicalSignal(service.cameraTransitionSignal(incomplete,otherCamera));
assert.ok(db.operational_signals.some(r=>r.provider_event_id===incomplete.transition_id),'signal-only fixture must actually persist its signal');
db.operational_awareness=db.operational_awareness.filter(r=>!r.related_signals.includes(incomplete.transition_id));
assert.equal(await service.cameraTransitionMaterialized(incomplete.transition_id,otherCamera),false);
db.camera_health_transition_outbox.push(incomplete);await service.deliverCameraTransitions();assert.equal(incomplete.delivery_state,'retryable_failure');assert.equal(incomplete.acknowledged_at,null);
console.log('PASS crash after submission retry uses stable identity; signal-only duplicate retains retryable obligation');
const runtime=require('../dist/oyi-core/service.js').oyiCoreRuntime,originalReceive=runtime.receiveSignal;
runtime.receiveSignal=async()=>{throw Error('fixture ingress unavailable')};
const failedCamera={...camera,id:randomUUID()};db.facility_cameras.push(failedCamera);
const failedRow={...rows[0],camera_id:failedCamera.id,transition_id:'camera-health:failed:1',checkpoint_revision:1,delivery_state:'pending',lease_until:null};db.camera_health_transition_outbox.push(failedRow);
await service.deliverCameraTransitions();assert.equal(failedRow.delivery_state,'retryable_failure');assert.equal(failedRow.acknowledged_at,null);runtime.receiveSignal=originalReceive;
console.log('PASS failed submission preserves durable retry obligation, no false acknowledgement');
const privateCamera={...camera,id:randomUUID(),home_id:randomUUID(),privacy_scope:'home'};
for(const [index,current,type] of [[1,'degraded','camera.health.degraded'],[2,'healthy','camera.video.restored']]){
 const r={...rows[0],transition_id:`camera-health:${privateCamera.id}:${index}`,camera_id:privateCamera.id,current_state:current,transition_type:type};
 const signal=service.cameraTransitionSignal(r,privateCamera);assert.equal(signal.unitId,privateCamera.home_id);assert.equal(signal.metadata.privacy_scope,'home');
 await submitCanonicalSignal(signal);assert.equal(await service.cameraTransitionMaterialized(r.transition_id,privateCamera),true);
 assert.equal(db.operational_signals.find(s=>s.provider_event_id===r.transition_id).home_id,privateCamera.home_id);
}
console.log('PASS private Home canonical scope and real materialization retained for impairment/recovery');
const sql=readFileSync('supabase/migrations/20260924101810_wave6_camera_health_transition_outbox.sql','utf8');assert.ok(!/set\s+(status|health_status|stream_status)\s*=/i.test(sql));
console.log('Slice14E functional passed');
