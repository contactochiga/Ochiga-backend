import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const now=Date.parse('2026-09-24T12:00:00Z'),iso=age=>new Date(now-age).toISOString();
const id='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',estate='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const actor={id:'resident',role:'resident',estate_id:estate,home_id:'home-a'};
const base={id,estate_id:estate,home_id:'home-a',privacy_scope:'home',metadata:{},edge_node_id:'edge-a',nvr_id:null,channel:null,ai_enabled:true,runtime_observations:null};
const node={estate_id:estate,edge_node_id:'edge-a',heartbeat_observed_at:iso(1000),heartbeat_received_at:iso(900),heartbeat_observation:{version:1,source:'edge_heartbeat',status:'online',queue_depth:0,sync_status:'synced',error_count:0,expected_interval_ms:30000}};
let serial=0,queries=[],rows=[],nodes=[node],dbError=false;
const client={from(table){assert.ok(['facility_cameras','edge_nodes'].includes(table),'no history/provider/write');let fields,filters=[],limit;
 const q={select(v){fields=v;return q},eq(k,v){filters.push(r=>r[k]===v);return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},limit(v){limit=v;return q},then(a,b){queries.push({table,fields});const data=(table==='facility_cameras'?rows:nodes).filter(r=>filters.every(f=>f(r))).slice(0,limit).map(r=>Object.fromEntries(fields.split(',').map(k=>[k,structuredClone(r[k])])));return Promise.resolve({data,error:dbError?Error('fixture DB failure'):null}).then(a,b)}};return q}};
const moduleId=require.resolve('../dist/supabase/supabaseClient.js');require.cache[moduleId]={id:moduleId,filename:moduleId,loaded:true,exports:{supabaseAdmin:client}};
const {cameraCurrentState:interpret,resolveCameraCurrentStates:batch}=require('../dist/modules/cameras/cameraCurrentStateAuthority.js');
let assertions=0;function eq(a,b){assert.deepEqual(a,b);assertions++}
function obs(kind,source,result,age=1000,details={}){return{schema_version:1,observation_id:`00000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`,camera_id:id,edge_node_id:'edge-a',kind,source,result,observed_at:iso(age),received_at:iso(Math.max(0,age-100)),details:kind==='frame'&&result==='acquired'?{mime_type:'image/jpeg',size_bytes:4,validation:'bounded_image_signature',...details}:details}}
function camera(...observations){const dimensions={};for(const o of observations)dimensions[`${o.kind}:${o.source}`]={latest:o,...(o.kind==='frame'&&o.result==='acquired'?{last_success:o}:{})};return{...base,runtime_observations:{version:1,dimensions}}}
const policy={now,windows:{'reachability:onvif_probe':{freshMs:100000,expiresMs:190000,basis:'fixture explicitly scheduled probe'},'reachability:tcp_probe':{freshMs:100000,expiresMs:190000,basis:'fixture explicitly scheduled endpoint probe'}}};
const frame=age=>obs('frame','ai_snapshot','acquired',age);
const reach=result=>obs('reachability','onvif_probe',result);
const stream=result=>obs('stream','go2rtc_inspection',result,1000,{stream_present:true,producer_count:1,consumer_count:0});
const inference=result=>obs('inference','external_detector',result,1000,{detection_count:0});
const run=(c,edge=node,options=policy)=>interpret(c,actor,edge,options);

// Components preserve distinct evidence strength and absence.
eq(run(camera(reach('succeeded'))).reachability.state,'succeeded');
eq(run(camera(reach('failed'))).reachability.state,'failed');
eq(run(camera()).reachability.state,'unknown');
eq(run(camera(obs('reachability','onvif_probe','succeeded',120000))).reachability.freshness,'stale');
eq(run(camera(reach('succeeded')),node,{now}).reachability.freshness,'unspecified');
eq(run(camera(stream('inspected'))).stream.state,'inspected');
eq(run(camera(stream('failed'))).stream.state,'failed');
eq(run(camera(stream('inspected'))).overall,'unknown');
eq(run(camera()).stream.state,'unknown');
eq(run(camera(obs('stream_configuration','go2rtc_registry','configured'))).overall,'unknown');
eq(run(camera(frame(1000))).frame.state,'acquired');
eq(run(camera(frame(70000))).frame.freshness,'stale');
eq(run(camera()).frame.state,'unknown');
const history=camera(obs('frame','ai_snapshot','failed'));history.runtime_observations.dimensions['frame:ai_snapshot'].last_success=frame(2000);
eq(run(history).overall,'unavailable');eq(run(history).frame.lastSuccess.length,1);eq(run(history).frame.lastSuccess[0].result,'acquired');
eq(run(camera(inference('succeeded'))).inference.state,'succeeded');eq(run(camera(inference('succeeded'))).inference.evidence[0].details.detection_count,0);
for(const result of ['failed','skipped','dropped'])eq(run(camera(inference(result))).inference.state,result);
eq(run(camera()).inference.state,'unknown');
for(const result of ['succeeded','failed']){const c={...camera(obs('reachability','tcp_probe',result)),nvr_id:'recorder-a'};eq(run(c).reachability.state,result);eq(run(c).recorder.state,'unknown');}
eq(run(camera()).recorder.state,'unknown');
console.log('PASS component success/failure/absence/stale/unspecified; TCP cannot invent recorder binding');

// A-J. Inspection failure is management-path failure, not proof of video failure.
const a=camera(reach('succeeded'),stream('inspected'),frame(1000),inference('succeeded'));
eq(run(a).overall,'healthy'); // A
eq(run(camera(reach('succeeded'),stream('failed'))).overall,'unknown'); // B
eq(run(camera(stream('inspected'),frame(70000))).overall,'unknown'); // C
eq(run(camera(frame(1000),inference('failed'))).overall,'degraded'); // D
const expired={...node,heartbeat_observed_at:iso(300000),heartbeat_received_at:iso(299900)};
eq(run(camera(frame(300000)),expired).overall,'unknown');eq(run(camera(frame(300000)),expired).edge.connectivity,'unavailable'); // E
eq(run(camera(frame(1000)),expired).videoEvidence,'recent_acquisition');eq(run(camera(frame(1000)),expired).overall,'degraded'); // F
eq(run(camera(frame(1000),reach('failed'))).overall,'degraded'); // G
eq(run({...history,status:'online',health_status:'healthy',stream_status:'online',last_seen_at:iso(0)}).overall,'unavailable'); // H
eq(run({...a,status:'offline',health_status:'offline',stream_status:'offline',camera_infrastructure:{health_state:'offline'}}).overall,'healthy'); // I
eq(run(base).overall,'unknown'); // J
eq(run({...a,metadata:{frame_freshness_at:iso(600000),stream_status:'offline'},frame_freshness_at:iso(600000),last_seen_at:iso(600000)}).overall,'healthy');
eq(run({...base,status:'online',health_status:'healthy',stream_status:'online',last_seen_at:iso(0),metadata:{frame_freshness_at:iso(0)}}).overall,'unknown');
eq(run(camera(frame(1000),stream('failed'))).overall,'degraded');
eq(run(camera(frame(1000),obs('frame','go2rtc_snapshot','failed')),node,{...policy,windows:{...policy.windows,'frame:go2rtc_snapshot':{freshMs:10000,expiresMs:20000,basis:'fixture capture requirement'}}}).overall,'degraded');
console.log('PASS A-J and conflicting acquisition paths; unknown is not unavailable');

// Receipt replay, clock, restart, invalid evidence and assignment.
const original=run(a),replayed=structuredClone(a);for(const e of Object.values(replayed.runtime_observations.dimensions))e.latest.received_at=iso(0);
eq(run(replayed).overall,original.overall);eq(run(replayed).frame.evidence[0].freshness,original.frame.evidence[0].freshness);
eq(run(structuredClone(a)),original);eq(run(a,node,{...policy,now:now+600000}).overall,'unknown');
for(const patch of [{observed_at:iso(-20000)},{camera_id:'other-camera'},{edge_node_id:'other-node'},{schema_version:99},{details:{validation:'decoded',mime_type:'image/jpeg',size_bytes:4}}]){const c=camera(frame(1000));Object.assign(c.runtime_observations.dimensions['frame:ai_snapshot'].latest,patch);eq(run(c).overall,'unknown')}
eq(run(a,{...node,estate_id:'other-estate'}).edge.connectivity,'unknown');
eq(run({...base,runtime_observations:{version:2,dimensions:a.runtime_observations.dimensions}}).overall,'unknown');
assert.throws(()=>interpret({...base,home_id:'home-b'},actor,node,policy),/Permission denied/);
assert.throws(()=>interpret({id},actor,node,policy),/projection_incomplete/);
const privateB={...a,home_id:'home-b',metadata:{home_id:'home-a'}};
assert.throws(()=>interpret(privateB,actor,node,policy),/Permission denied/);
for(const role of ['facility_manager','estate_admin','security']){
 const operator={id:'operator',role,estate_id:estate,home_id:null};
 assert.throws(()=>interpret(a,operator,node,policy),/Permission denied/);
 eq(interpret({...a,home_id:null,privacy_scope:'facility'},operator,node,policy).overall,'healthy');
 assert.throws(()=>interpret({...a,estate_id:'foreign',home_id:null,privacy_scope:'facility'},operator,node,policy),/Permission denied/);
}
assert.throws(()=>run(a,node,{now,windows:{'frame:ai_snapshot':{freshMs:-1,expiresMs:2,basis:'invalid'}}}),/invalid_camera_freshness_policy/);
console.log('PASS source-time/restart/projection/future-clock/tenant validation');

const frozen=JSON.stringify({a,node});run(a);eq(JSON.stringify({a,node}),frozen);
for(const count of [1,10,50,100]){
 rows=Array.from({length:count},(_,i)=>{const c=structuredClone(a);c.id=`camera-${i}`;for(const entry of Object.values(c.runtime_observations.dimensions)){entry.latest.camera_id=c.id;if(entry.last_success)entry.last_success.camera_id=c.id}return c});
 queries=[];const results=await batch(estate,rows.map(c=>c.id),actor,policy);eq(results.length,count);eq(queries.length,2);eq(results.every(r=>r.overall==='healthy'),true);
 eq(queries.map(q=>q.table),['facility_cameras','edge_nodes']);
}
rows=[a,{...a,id:'denied',home_id:'home-b'},{...a,id:'cross',estate_id:'another'}];queries=[];
eq((await batch(estate,[id,'denied','cross'],actor,policy)).map(c=>c.cameraId),[id]);
queries=[];eq(await batch(estate,['denied'],actor,policy),[]);eq(queries.length,1);
dbError=true;await assert.rejects(()=>batch(estate,[id],actor,policy),/fixture DB failure/);dbError=false;
const source=readFileSync(new URL('../src/modules/cameras/cameraCurrentStateAuthority.ts',import.meta.url),'utf8');
assert.ok(!/\.from\(["'](?:camera_infrastructure|camera_health_history|edge_heartbeats)["']\)|\.update\(|\.insert\(|\.rpc\(|submitCameraHealthCanonicalSignal|classifyCameraHealthTransition/.test(source));
const metrics=require('../dist/observability/metrics.js').operationalMetrics.snapshot();eq(metrics.filter(m=>m.name.startsWith('camera_current_state')).every(m=>Object.keys(m.labels).every(k=>k==='overall')),true);
console.log(`PASS bounded 1/10/50/100 batches, canonical privacy, no writes/signals/provider calls; ${assertions} assertions plus throw/source guards`);
