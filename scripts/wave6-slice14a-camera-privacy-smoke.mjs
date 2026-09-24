import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
process.env.APP_JWT_SECRET = 'slice14a-local-fixture-secret';
process.env.SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only';
const stub = (file, exports) => { const id = require.resolve(file); require.cache[id] = { id, filename: id, loaded: true, exports }; };
let db, queries, writes, deliveries, fetches;
const A='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', B='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', C='cccccccc-cccc-4ccc-cccc-cccccccccccc', X='dddddddd-dddd-4ddd-dddd-dddddddddddd';
const now='2026-09-24T10:00:00.000Z';
function reset() {
  queries=[]; writes=[]; deliveries=[]; fetches=[];
  db={
    facility_cameras:[
      {id:A,estate_id:'estate-a',home_id:'home-a',privacy_scope:'home',metadata:{home_id:'home-b',privacy_scope:'home',frame_freshness_at:now,office_allowed_user_ids:['b']},edge_node_id:'edge-a',updated_at:now,status:'online',name:'Private A',edge_hls_url:'https://edge.example/api/stream.m3u8?src=A'},
      {id:B,estate_id:'estate-a',home_id:'home-b',privacy_scope:'home',metadata:{home_id:'home-b',privacy_scope:'home'},edge_node_id:'edge-b',updated_at:now,status:'online',name:'Private B',edge_hls_url:'https://edge.example/api/stream.m3u8?src=B'},
      {id:C,estate_id:'estate-a',home_id:null,privacy_scope:'facility',metadata:{},edge_node_id:'edge-a',updated_at:now,status:'online',name:'Common',edge_hls_url:'https://edge.example/api/common.m3u8?src=C'},
      {id:X,estate_id:'estate-x',home_id:null,privacy_scope:'facility',metadata:{},edge_node_id:'edge-x',updated_at:now,status:'online'},
    ],
    users:[{id:'a',role:'resident',estate_id:'estate-a',home_id:'home-a'},{id:'b',role:'resident',estate_id:'estate-a',home_id:'home-b'},{id:'fm',role:'facility_manager',estate_id:'estate-a'}, {id:'security',role:'security',estate_id:'estate-a'},{id:'x',role:'facility_manager',estate_id:'estate-x'}, {id:'admin',role:'admin',estate_id:'estate-a'}],
    estate_memberships:['a','b','fm','security'].map(id=>({user_id:id,estate_id:'estate-a',status:'active',role:id==='fm'?'manager':'resident'})).concat({user_id:'x',estate_id:'estate-x',status:'active',role:'manager'}),
    home_memberships:[{id:'ma',user_id:'a',home_id:'home-a',status:'active'},{id:'mb',user_id:'b',home_id:'home-b',status:'active'}],
    estates:[{id:'estate-a',name:'A'},{id:'estate-x',name:'X'}], homes:[{id:'home-a',estate_id:'estate-a'},{id:'home-b',estate_id:'estate-a'}],
    camera_infrastructure:[{camera_id:A,estate_id:'estate-a',health_state:'online'},{camera_id:C,estate_id:'estate-a',health_state:'online'},{camera_id:'orphan',estate_id:'estate-a',health_state:'online'}],
    camera_health_history:[{camera_id:A,estate_id:'estate-a'},{camera_id:C,estate_id:'estate-a'},{camera_id:'orphan',estate_id:'estate-a'}],
    camera_media:[{id:'media-a',camera_id:A,estate_id:'estate-a',status:'ready',storage_key:'private-a'},{id:'media-b',camera_id:B,estate_id:'estate-a',status:'ready'}],
    edge_nodes:[],camera_events:[],camera_detections:[],camera_event_media:[],camera_detection_zones:[],notifications:[],edge_commands:[],audit_events:[],
  };
}
const project=(row,select)=>select==='*'?structuredClone(row):Object.fromEntries(select.split(',').map(s=>s.trim()).filter(Boolean).map(key=>{const field=key.replace(/\(\*\)$/,'');return [field,row[field]??null]}));
const client={from(table){
  const q={table,select:'*',filters:[],op:'read'};queries.push(q);
  const b={
    select(s='*'){q.select=s;return b},eq(k,v){q.filters.push(r=>r[k]===v);return b},is(k,v){q.filters.push(r=>(r[k]??null)===v);return b},
    in(k,v){q.filters.push(r=>v.includes(r[k]));return b},neq(k,v){q.filters.push(r=>r[k]!==v);return b},
    gte(k,v){q.filters.push(r=>r[k]>=v);return b},lte(k,v){q.filters.push(r=>r[k]<=v);return b},gt(k,v){q.filters.push(r=>r[k]>v);return b},lt(k,v){q.filters.push(r=>r[k]<v);return b},
    contains(k,v){q.filters.push(r=>Object.entries(v).every(([key,val])=>r[k]?.[key]===val));return b},
    order(){return b},limit(n){q.limit=n;return b},
    insert(v){q.op='insert';q.value=v;return b},upsert(v){q.op='insert';q.value=v;return b},update(v){q.op='update';q.value=v;return b},delete(){q.op='delete';return b},
    maybeSingle(){return run(true)},single(){return run(true)},then(a,z){return run(false).then(a,z)},
  };
  async function run(single){
    assert.ok(Object.hasOwn(db,table),'unexpected table '+table);
    let rows=db[table].filter(r=>q.filters.every(f=>f(r)));
    if(q.op==='insert'){rows=(Array.isArray(q.value)?q.value:[q.value]).map((r,i)=>({id:'fixture-'+db[table].length+'-'+i,...structuredClone(r)}));db[table].push(...rows);writes.push({table,rows});}
    if(q.op==='update'){for(const row of rows)Object.assign(row,structuredClone(q.value));writes.push({table,rows});}
    if(q.op==='delete')db[table]=db[table].filter(r=>!rows.includes(r));
    if(q.limit)rows=rows.slice(0,q.limit);
    return {data:single?(rows[0]?project(rows[0],q.select):null):rows.map(r=>project(r,q.select)),error:null};
  }return b;
}};
stub('../dist/supabase/supabaseClient.js',{supabaseAdmin:client});
stub('../dist/core/foundation/index.js',{emitAuditEvent:async()=>{},hasPermission:()=>true,permissionsForRole:()=>['cameras.view']});
stub('../dist/core/foundation/audit.js',{emitAuditEvent:async()=>{}});
stub('../dist/intelligence-core/index.js',{normalizeIntelligenceEvent:x=>x,publishIntelligenceEvent:async()=>({ok:true}),publishSourceIntelligenceEvent:async()=>({ok:true})});
stub('../dist/oyi-core/service.js',{oyiCoreRuntime:{decorateRealtimePayload:()=>({})}});
stub('../dist/oyi-core/ingress/canonicalSignalIngress.js',{submitCanonicalSignal:async()=>({})});
stub('../dist/services/notificationPolicyService.js',{decideNotification:async()=>null,recordNotificationDecision:async()=>{}});
stub('../dist/services/PushNotificationService.js',{PushNotificationService:{sendToUsers:async(ids)=>deliveries.push(...ids)}});
const policy=require('../dist/modules/cameras/cameraAccess.policy.js');
const playback=require('../dist/modules/cameras/cameraPlayback.service.js');
const stream=require('../dist/controllers/cameraStreamController.js');
const media=require('../dist/modules/cameras/cameraMedia.service.js');
const mediaCtrl=require('../dist/controllers/cameraMediaController.js');
const detection=require('../dist/modules/cameras/cameraDetection.service.js');
const detectionCtrl=require('../dist/controllers/cameraDetectionController.js');
const intelCtrl=require('../dist/controllers/cameraIntelController.js');
const audience=require('../dist/modules/cameras/cameraAudience.service.js');
const {NotificationService}=require('../dist/services/NotificationService.js');
const {platformGapService}=require('../dist/services/platformGapService.js');
const {setIO}=require('../dist/realtime/io.js');
const {emitSignal}=require('../dist/realtime/emitSignal.js');
const edge=require('../dist/routes/edgeDiscovery.js').edgeDiscoveryRouter;
const edgeAuth=require('../dist/middleware/edgeToken.js');
const jwt=require('jsonwebtoken');
function res(){return {statusCode:200,body:null,status(n){this.statusCode=n;return this},json(v){this.body=v;return this},send(v){this.body=v;return this},end(){return this},setHeader(){return this}}}
function req(user='a',cameraId=A){return {user:db.users.find(u=>u.id===user),params:{cameraId},query:{},body:{},headers:{host:'backend.example'},method:'GET',protocol:'https',get:()=> 'backend.example'}}
let passed=0;
async function test(name,fn){reset();setIO(null);await fn();passed++;console.log('PASS '+name)}
global.fetch=async url=>{fetches.push(String(url));return new Response('#EXTM3U\n#EXTINF:2\nsegment.ts\n',{status:200,headers:{'content-type':'application/vnd.apple.mpegurl'}})};

await test('reproduces original reduced projection defect; shared projection matches full canonical policy',()=>{
  const cam=db.facility_cameras[0],actor=db.users[1];assert.equal(policy.canAccessCamera(cam,actor).ok,false);
  assert.equal(policy.canAccessCamera(project(cam,'id,estate_id,metadata'),actor).ok,true);
  for(const camera of db.facility_cameras)for(const user of db.users)assert.deepEqual(policy.canAccessCamera(project(camera,policy.CAMERA_ACCESS_SELECT),user),policy.canAccessCamera(camera,user));
});
await test('actual role matrix including literal non-policy aliases; no invented privileges',()=>{
  for(const role of ['resident','facility_manager','security','estate_admin','admin','security_operator','ochiga_admin']){
    const actor={id:'role',estate_id:'estate-a',home_id:'home-a',role};
    const platform=role==='admin';assert.equal(policy.canAccessCamera(db.facility_cameras[1],actor).ok,platform);
    assert.equal(policy.canAccessCamera(db.facility_cameras[2],actor).ok,['facility_manager','security','estate_admin','admin'].includes(role));
    assert.equal(policy.canAccessCamera(db.facility_cameras[3],actor).ok,platform);
  }
});
await test('playlist and segment handlers bind camera, token, canonical scope and exact resource',async()=>{
  const token=playback.issueCameraPlaybackToken(db.users[0],db.facility_cameras[0]);
  const r=req();r.query.token=token;let out=res();await stream.hlsPlaylist(r,out);assert.equal(out.statusCode,200);
  const url=new URL(out.body.split('\n').find(s=>s.startsWith('https:')));
  const seg=decodeURIComponent(url.pathname.split('/hls/')[1]);
  const sr=req();sr.params.seg=seg;sr.query=Object.fromEntries(url.searchParams);out=res();await stream.hlsSegment(sr,out);assert.equal(out.statusCode,200);
  for(const handler of [stream.hlsPlaylist,stream.hlsSegment]){const bad={...sr,params:{...sr.params,cameraId:B}};out=res();await handler(bad,out);assert.equal(out.statusCode,403);}
  out=res();await stream.hlsSegment({...sr,params:{...sr.params,seg:'https://edge.example/api/stream.m3u8?src=B'}},out);assert.equal(out.statusCode,403);
  out=res();await stream.hlsSegment({...sr,query:{token}},out);assert.equal(out.statusCode,403);
  const unauthorized=jwt.sign({id:'b',role:'resident',estate_id:'estate-a',home_id:'home-b',camera_id:A},process.env.APP_JWT_SECRET,{expiresIn:120});
  out=res();await stream.hlsPlaylist({...r,query:{token:unauthorized}},out);assert.equal(out.statusCode,403);
  for(const bad of ['invalid',jwt.sign({id:'a',role:'resident',estate_id:'estate-a',home_id:'home-a'},process.env.APP_JWT_SECRET),jwt.sign({id:'a',role:'resident',estate_id:'estate-a',home_id:'home-a',camera_id:A},process.env.APP_JWT_SECRET,{expiresIn:-1})]){
    for(const handler of [stream.hlsPlaylist,stream.hlsSegment]){out=res();await handler({...sr,query:{...sr.query,token:bad}},out);assert.equal(out.statusCode,401);}
  }
  const common=req('fm',C);common.query.token=playback.issueCameraPlaybackToken(common.user,db.facility_cameras[2]);out=res();await stream.hlsPlaylist(common,out);assert.equal(out.statusCode,200);
});
await test('media/snapshot/detection endpoint projections deny conflicting legacy Home and preserve authorized reads',async()=>{
  assert.equal((await media.resolveMediaAccess('media-a',db.users[1])).ok,false);
  assert.equal((await media.resolveMediaAccess('media-a',db.users[0])).ok,true);
  for(const handler of [mediaCtrl.requestSnapshot,mediaCtrl.listCameraMedia,mediaCtrl.getRecordingPolicy,detectionCtrl.listDetectionZones]){
    const out=res();await handler(req('b'),out);assert.equal(out.statusCode,403);
  }
  assert.equal((await detection.queryDetections({cameraId:A,user:db.users[1],query:{}})).ok,false);
  assert.equal((await detection.queryDetections({cameraId:A,user:db.users[0],query:{}})).ok,true);
  const out=res();await mediaCtrl.requestSnapshot(req('a'),out);assert.equal(out.statusCode,202);assert.equal(db.edge_commands[0].home_id,'home-a');
});
await test('infrastructure reads filter private and orphan rows; writes authorize canonical camera',async()=>{
  const r=req('fm');r.query={estate_id:'estate-a'};
  const result=await platformGapService.cameraInfrastructure(r);assert.deepEqual(result.items.map(x=>x.camera_id),[C]);assert.deepEqual(result.history.map(x=>x.camera_id),[C]);
  r.method='PUT';r.body={estate_id:'estate-a',camera_id:A};await assert.rejects(()=>platformGapService.upsertCameraInfrastructure(r),/Permission denied/);
  r.body.camera_id='orphan';await assert.rejects(()=>platformGapService.upsertCameraInfrastructure(r),/Canonical facility camera/);
  r.method='GET';r.query={estate_id:'estate-x'};await assert.rejects(()=>platformGapService.cameraInfrastructure(r),/scope/);
});
await test('14F infrastructure projection uses canonical state, never conflicting operator health; bounded camera batches',async()=>{
  const ts=Date.now(),time=age=>new Date(ts-age).toISOString();
  const edge={edge_node_id:'edge-a',estate_id:'estate-a',heartbeat_observed_at:time(1000),heartbeat_received_at:time(900),heartbeat_observation:{version:1,source:'edge_heartbeat',status:'online',queue_depth:0,sync_status:'synced',error_count:0,expected_interval_ms:30000}};
  db.edge_nodes=[edge];
  for(const [result,age,expected] of [['acquired',1000,'healthy'],['failed',1000,'unavailable'],['acquired',300000,'unknown'],[null,0,'unknown']]) {
    const latest={schema_version:1,observation_id:'00000000-0000-4000-8000-000000000001',camera_id:C,edge_node_id:'edge-a',kind:'frame',source:'ai_snapshot',result,observed_at:time(age),received_at:time(age),details:result==='acquired'?{mime_type:'image/jpeg',size_bytes:4,validation:'bounded_image_signature'}:{}};
    db.facility_cameras=[{id:C,name:'Common',estate_id:'estate-a',home_id:null,privacy_scope:'facility',metadata:{},edge_node_id:'edge-a',nvr_id:null,channel:null,ai_enabled:true,status:'online',runtime_observations:{version:1,dimensions:result?{'frame:ai_snapshot':{latest}}:{}}}];
    db.camera_infrastructure=[{camera_id:C,estate_id:'estate-a',health_state:'offline',placement_id:'placement-preserved'}];
    const r=req('fm');r.query={estate_id:'estate-a'};
    const out=await platformGapService.cameraInfrastructure(r);
    assert.equal(out.items[0].health_state,expected);assert.equal(out.items[0].current_state.overall,expected);assert.equal(out.items[0].placement_id,'placement-preserved');
  }
  const template=db.facility_cameras[0];
  for(const count of [10,50,100]){
    db.facility_cameras=Array.from({length:count},(_,i)=>({...template,id:`camera-${i}`}));
    db.camera_infrastructure=db.facility_cameras.map(c=>({camera_id:c.id,estate_id:'estate-a',health_state:'online'}));db.camera_health_history=[];queries=[];
    const r=req('fm');r.query={estate_id:'estate-a'};const out=await platformGapService.cameraInfrastructure(r);
    assert.equal(out.items.length,count);assert.ok(out.items.every(item=>item.health_state==='unknown'));
    assert.equal(queries.filter(q=>q.table==='facility_cameras').length,2);assert.equal(queries.filter(q=>q.table==='edge_nodes').length,1);
    console.log(`Infrastructure ${count} cameras: ${queries.length} total reads including membership context; 2 camera reads + 1 Edge read`);
  }
});
await test('realtime never broadcasts camera payload to estate; only eligible sockets receive',async()=>{
  const received=[];const sockets=db.users.map(u=>({data:{user:u},emit:(event)=>received.push([u.id,event])}));
  setIO({fetchSockets:async()=>sockets,to:()=>{throw Error('broad room forbidden')},emit:()=>{throw Error('global forbidden')}});
  await emitSignal({type:'camera.event',estateId:'estate-a',metadata:{camera_id:A}});
  assert.deepEqual([...new Set(received.map(r=>r[0]))].sort(),['a','admin']);received.length=0;
  await emitSignal({type:'camera.status.updated',estateId:'estate-a',metadata:{camera_id:C}});
  assert.equal(received.length,0); // 14E retired ambiguous legacy operational transport
  await emitSignal({type:'camera.health.transition',estateId:'estate-a',metadata:{camera_id:C}}, {skipCanonicalIngress:true});
  assert.deepEqual([...new Set(received.map(r=>r[0]))].sort(),['admin','fm','security']);received.length=0;
  await emitSignal({type:'camera.event',metadata:{camera_id:'orphan'}});assert.equal(received.length,0);
});
await test('notification fan-out filters before insertion/push; common operational audience preserved',async()=>{
  await NotificationService.sendToEstate('estate-a',{type:'security',title:'Camera',message:'Protected',payload:{camera_id:A}});
  assert.deepEqual(db.notifications.map(n=>n.user_id).sort(),['a','admin']);assert.deepEqual(deliveries.sort(),['a','admin']);
  db.notifications=[];deliveries=[];
  await NotificationService.sendToEstate('estate-a',{type:'security',title:'Common',message:'Common',payload:{cameraId:C}});
  assert.deepEqual(db.notifications.map(n=>n.user_id).sort(),['admin','fm','security']);
});
await test('10/50/100 camera notification batches use four scope queries, no per-camera lookup',async()=>{
  for(const n of [10,50,100]){queries=[];db.facility_cameras=Array.from({length:n},(_,i)=>({...db.facility_cameras[0],id:'batch-'+i}));const rows=db.facility_cameras.flatMap(c=>[{user_id:'a',payload:{camera_id:c.id}},{user_id:'b',payload:{camera_id:c.id}}]);const filtered=await audience.filterCameraNotificationRows(rows);assert.equal(filtered.length,n);assert.equal(queries.length,4);}
});
function edgeHandler(path){return edge.stack.find(layer=>layer.route?.path===path).route.stack.at(-1).handle}
await test('assigned Edge health allowed, metadata preserved; wrong estate/node/arbitrary camera rejected without writes/signals',async()=>{
  const handler=edgeHandler('/edge/cameras/:cameraId/stream-health');
  let r={params:{cameraId:A},edgeAgent:{id:'edge-a',siteId:'estate-a'},body:{status:'online',metadata:{privacy_scope:'facility',home_id:'home-b'}}};let out=res();await handler(r,out);assert.equal(out.statusCode,200);assert.equal(db.facility_cameras[0].metadata.home_id,'home-b');assert.equal(db.facility_cameras[0].home_id,'home-a');assert.equal(db.facility_cameras[0].metadata.frame_freshness_at,now);
  for(const id of [B,X,'unknown']){writes=[];out=res();await handler({...r,params:{cameraId:id}},out);assert.equal(out.statusCode,403);assert.equal(writes.length,0);}
});
await test('Edge bound identity rejects spoofed tenant and legacy camera credentials',async()=>{
  process.env.OYI_EDGE_AGENT_IDENTITIES=JSON.stringify([{token:'bound-fixture',agent_id:'edge-a',site_id:'estate-a'}]);
  let next=0;let out=res();edgeAuth.requireCameraEdgeToken({headers:{authorization:'Bearer bound-fixture'},body:{site_id:'estate-x',agent_id:'edge-a'},query:{},path:'/edge/cameras'},out,()=>next++);assert.equal(out.statusCode,401);assert.equal(next,0);
  out=res();edgeAuth.requireCameraEdgeToken({headers:{authorization:'Bearer bound-fixture'},body:{site_id:'estate-a',agent_id:'edge-a'},query:{},path:'/edge/cameras'},out,()=>next++);assert.equal(next,1);
  process.env.OYI_EDGE_ALLOW_LEGACY_TOKEN='true';process.env.OYI_EDGE_AGENT_TOKEN='legacy-fixture';out=res();edgeAuth.requireCameraEdgeToken({headers:{authorization:'Bearer legacy-fixture'},body:{site_id:'estate-a',agent_id:'edge-a'},query:{},path:'/edge/cameras'},out,()=>next++);assert.equal(out.statusCode,403);assert.equal(next,1);
  for(const path of ['/edge/cameras/:cameraId/stream-health','/edge/cameras/:cameraId/events','/edge/cameras/:cameraId/media','/edge/cameras/:cameraId/detections'])assert.equal(edge.stack.find(l=>l.route?.path===path).route.stack[0].handle,edgeAuth.requireCameraEdgeToken);
});
await test('legacy Edge event ingestion also requires canonical tenant/node assignment',async()=>{
  const handler=edgeHandler('/edge/cameras/:cameraId/events');
  for(const id of [B,X,'unknown']){const out=res();await handler({params:{cameraId:id},edgeAgent:{id:'edge-a',siteId:'estate-a'},body:{event_type:'motion'}},out);assert.equal(out.statusCode,404);assert.equal(db.camera_events.length,0);}
  const out=res();await handler({params:{cameraId:A},edgeAgent:{id:'edge-a',siteId:'estate-a'},body:{event_type:'motion'}},out);assert.equal(out.statusCode,200);assert.equal(db.camera_events[0].camera_id,A);assert.equal(db.camera_events[0].estate_id,'estate-a');
});
await test('detection/media ingress rejects wrong tenant/node before persistence/storage and validates event relationship',async()=>{
  const input={cameraId:A,siteId:'estate-a',nodeId:'edge-a',provider:'fixture',detections:[{type:'person',observed_at:new Date().toISOString(),confidence:.9}]};
  for(const change of [{siteId:'estate-x'},{nodeId:'edge-b'},{cameraId:B}]){assert.equal((await detection.ingestEdgeDetections({...input,...change})).code,'detection_access_denied');const result=await media.ingestEdgeMedia({...input,...change,kind:'snapshot',mimeType:'image/jpeg',base64:'/9j/AA==',idempotencyKey:'test'}, {put:()=>{throw Error('unauthorized storage')}});assert.equal(result.code,'media_access_denied');}
  assert.equal((await detection.ingestEdgeDetections({...input,mediaId:'media-b'})).code,'invalid_media_relationship');
  const detected=await detection.ingestEdgeDetections(input);assert.equal(detected.ok,true);assert.equal(db.camera_detections[0].home_id,'home-a');
  const stored=[];
  const upload=await media.ingestEdgeMedia({...input,kind:'snapshot',mimeType:'image/jpeg',base64:Buffer.from([255,216,255,0]).toString('base64'),idempotencyKey:'valid-media'}, {put:async(key)=>stored.push(key),delete:async()=>{}});
  assert.equal(upload.ok,true);assert.equal(upload.media.home_id,'home-a');assert.equal(stored.length,1);assert.ok(stored[0].startsWith('estate-a/'+A+'/'));
  let signed=0;const store={exists:async()=>true,getSignedRead:async()=>{signed++;return {url:'fixture-authorized-url',expiresAt:now}}};
  assert.equal((await media.signedMediaAccess(upload.media.id,db.users[1],store)).ok,false);assert.equal(signed,0);
  assert.equal((await media.signedMediaAccess(upload.media.id,db.users[0],store)).ok,true);assert.equal(signed,1);
});
await test('reports filter protected events before aggregation with batched canonical scope',async()=>{
  for(const n of [10,50,100]){
    queries=[];db.camera_events=Array.from({length:n},(_,i)=>({id:'event-'+i,camera_id:i%2?A:C,estate_id:'estate-a',event_type:'motion',created_at:new Date().toISOString()}));
    const out=res();await intelCtrl.getSecurityReport(req('fm'),out);assert.equal(out.statusCode,200);assert.equal(out.body.report.totalEvents,n/2);assert.equal(JSON.stringify(out.body).includes(A),false);assert.equal(queries.filter(q=>q.table==='facility_cameras').length,1);
  }
});
await test('legacy corrupt event-media links cannot expose another camera',async()=>{
  db.camera_events=[{id:'event-a',camera_id:A,estate_id:'estate-a',created_at:new Date().toISOString()}];
  db.camera_event_media=[{event_id:'event-a',relationship:'evidence',camera_media:db.camera_media[1]},{event_id:'event-a',relationship:'evidence',camera_media:db.camera_media[0]}];
  const r=req();r.params.eventId='event-a';const out=res();await mediaCtrl.listEventMedia(r,out);assert.deepEqual(out.body.items.map(x=>x.id),['media-a']);
  db.camera_detections=[{id:'wrong',camera_id:B,event_id:'event-a'},{id:'right',camera_id:A,event_id:'event-a'}];
  const events=res();await intelCtrl.listEvents(req(),events);assert.deepEqual(events.body.events[0].media.map(x=>x.id),['media-a']);assert.deepEqual(events.body.events[0].detections.map(x=>x.id),['right']);
});
await test('unresolved camera audit transport fails closed',async()=>{
  setIO({fetchSockets:async()=>{throw Error('unresolved must not fan out')},to:()=>{throw Error('broad room forbidden')}});
  await emitSignal({type:'audit.recorded',action:'camera.media.retention_deleted',resourceType:'camera_media',resourceId:'media-a',estateId:'estate-a'});
});
// Guard the selected-field contract for all newly converged readers. Integration
// above uses actual selects; this also catches a newly copied narrow select.
for(const file of ['cameraMediaController','cameraDetectionController','cameraIntelController','cameraStreamController'])assert.match(readFileSync(new URL('../src/controllers/'+file+'.ts',import.meta.url),'utf8'),/CAMERA_ACCESS_SELECT/);
console.log(`Slice 14A: ${passed} groups passed; assertions complete; normal process exit expected.`);
