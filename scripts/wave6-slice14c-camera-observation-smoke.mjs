import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.SUPABASE_URL='http://127.0.0.1:1';process.env.SUPABASE_SERVICE_ROLE_KEY='fixture';
process.env.APP_JWT_SECRET='slice14c-fixture';
const cameraId='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',estate='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const captured=new Date(Date.now()-60000).toISOString();
let failRpc=true,rpcs=[],puts=0;
const db={facility_cameras:[{id:cameraId,estate_id:estate,edge_node_id:'edge-a',home_id:'home-a',privacy_scope:'home',metadata:{home_id:'home-a'},updated_at:captured}],camera_media:[]};
const client={from(table){assert.ok(db[table]);let fields='*',filters=[],insert,update;
 const q={select(v='*'){fields=v;return q},eq(k,v){filters.push(r=>r[k]===v);return q},limit(){return q},insert(v){insert=v;return q},update(v){update=v;return q},single(){return run(true)},maybeSingle(){return run(true)},then(a,b){return run(false).then(a,b)}};
 async function run(single){let rows=db[table].filter(r=>filters.every(f=>f(r)));if(insert){rows=[structuredClone(insert)];db[table].push(...rows)}if(update)for(const r of rows)Object.assign(r,update);
 rows=rows.map(r=>fields==='*'?structuredClone(r):Object.fromEntries(fields.split(',').map(k=>[k,r[k]])));return{data:single?rows[0]||null:rows,error:null}}
 return q},async rpc(name,args){assert.equal(name,'oyi_ingest_camera_observations');rpcs.push(args);return failRpc?{error:{message:'fixture storage failure'}}:{data:{ok:true},error:null}}};
function stub(file,exports){const id=require.resolve(file);require.cache[id]={id,filename:id,loaded:true,exports}}
stub('../dist/supabase/supabaseClient.js',{supabaseAdmin:client});stub('../dist/core/foundation/index.js',{emitAuditEvent:async()=>{}});
const {ingestCameraObservations}=require('../dist/modules/cameras/cameraObservation.service.js');
const {ingestEdgeMedia}=require('../dist/modules/cameras/cameraMedia.service.js');
const store={put:async()=>{puts++},delete:async()=>{throw Error('unexpected deletion')}};
const input={cameraId,siteId:estate,nodeId:'edge-a',kind:'snapshot',mimeType:'image/jpeg',base64:Buffer.from([255,216,255,1]).toString('base64'),capturedAt:captured,idempotencyKey:'capture-a'};
const first=await ingestEdgeMedia(input,store);assert.equal(first.ok,false);assert.equal(first.code,'camera_observation_unavailable');assert.equal(db.camera_media.length,1);
failRpc=false;const retry=await ingestEdgeMedia(input,store);assert.equal(retry.ok,true);assert.equal(retry.created,false);assert.equal(puts,1);assert.equal(db.camera_media.length,1);
assert.deepEqual(rpcs[0],rpcs[1]);assert.equal(rpcs[1].p_observations[0].observed_at,captured);assert.equal(rpcs[1].p_observations[0].observation_id,retry.media.id);
assert.equal(rpcs[1].p_observations[0].details.validation,'bounded_image_signature');
console.log('PASS actual media persistence failure -> existing record retry repairs stable frame observation without blob reinsertion');
const before=rpcs.length;assert.equal((await ingestEdgeMedia({...input,nodeId:'edge-b'},store)).code,'media_access_denied');assert.equal(rpcs.length,before);
await assert.rejects(()=>ingestCameraObservations({id:'edge-a',siteId:estate},[{edge_node_id:'edge-b'}]),/assignment/);
await assert.rejects(()=>ingestCameraObservations({id:'edge-a',siteId:estate,legacy:true},[]),/identity/);
for(const n of [10,50,100]){const rows=Array.from({length:n},()=>({...rpcs[0].p_observations[0]}));const before=rpcs.length;await ingestCameraObservations({id:'edge-a',siteId:estate},rows);assert.equal(rpcs.length-before,1)}
console.log('PASS bound identity, no cross-assignment repair, 10/50/100 observations one RPC each');
stub('../dist/core/foundation/audit.js',{emitAuditEvent:async()=>{}});
stub('../dist/realtime/emitSignal.js',{makeBaseSignal:x=>x,emitSignal:()=>{throw Error('unexpected signal')},emitSignalSafely:()=>{throw Error('unexpected signal')}});
stub('../dist/intelligence-core/index.js',{normalizeIntelligenceEvent:x=>x,publishIntelligenceEvent:()=>{throw Error('unexpected intelligence event')}});
const router=require('../dist/routes/edgeDiscovery.js').edgeDiscoveryRouter;
const handler=router.stack.find(l=>l.route?.path==='/edge/camera-observations').route.stack.at(-1).handle;
function res(){return{statusCode:200,status(c){this.statusCode=c;return this},json(body){this.body=body;return this}}}
const req={edgeAgent:{id:'edge-a',siteId:estate},body:{observations:[{...rpcs[0].p_observations[0],source:'go2rtc_snapshot'}]}};
let response=res();await handler(req,response);assert.equal(response.statusCode,200);
response=res();await handler({...req,body:{observations:rpcs[0].p_observations}},response);assert.equal(response.statusCode,400);
failRpc=true;response=res();await handler(req,response);assert.equal(response.statusCode,503);
console.log('PASS actual observation route: accepted, reserved Backend source denied, retryable failure; zero signals');
db.facility_cameras.push({...db.facility_cameras[0],id:'other-node',edge_node_id:'edge-b'},{...db.facility_cameras[0],id:'other-estate',estate_id:'foreign'});
const registry=router.stack.find(l=>l.route?.path==='/edge/camera-observation-registry').route.stack.at(-1).handle;
response=res();await registry(req,response);assert.equal(response.body.cameras.length,1);assert.equal(response.body.cameras[0].canonical_camera_id,cameraId);assert.equal(response.body.site_id,estate);
assert.ok(!JSON.stringify(response.body).includes('home-a'));
console.log('PASS bound Edge registry filters other node/estate and exposes no Home metadata');
console.log('Slice14C Backend: passed; no live credentials/provider calls.');
