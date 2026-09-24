import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import './helpers/device-read-smoke-isolation.mjs';
const require=createRequire(import.meta.url);
const now=Date.now(),iso=age=>new Date(now-age).toISOString();
process.env.APP_JWT_SECRET='slice14f-fixture-only';
process.env.SUPABASE_URL='http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-only';
const estate='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',id='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const actor={id:'resident-a',role:'resident',estate_id:estate,home_id:'home-a'};
const operator={id:'operator',role:'facility_manager',estate_id:estate,home_id:'home-a'};
const base={id,name:'Test camera',estate_id:estate,home_id:'home-a',privacy_scope:'home',metadata:{},edge_node_id:'edge-a',nvr_id:null,channel:null,ai_enabled:true,runtime_observations:null,status:'online',health_status:'healthy',password:'DO_NOT_EXPOSE',edge_hls_url:'https://edge.example/live.m3u8'};
const node={estate_id:estate,edge_node_id:'edge-a',heartbeat_observed_at:iso(1000),heartbeat_received_at:iso(900),heartbeat_observation:{version:1,source:'edge_heartbeat',status:'online',queue_depth:0,sync_status:'synced',error_count:0,expected_interval_ms:30000}};
let rows=[],nodes=[node],queries=[],serial=0;
const client={from(table){let fields='*',filters=[],limit;const q={select(v='*'){fields=v;return q},eq(k,v){filters.push(r=>r[k]===v);return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},order(){return q},limit(n){limit=n;return q},maybeSingle(){return run(true)},single(){return run(true)},then(a,b){return run(false).then(a,b)}};
async function run(single){queries.push({table,fields});assert.ok(['facility_cameras','edge_nodes','estate_memberships','camera_dvrs','camera_events','camera_detections'].includes(table),'unexpected read '+table);const source=table==='facility_cameras'?rows:table==='edge_nodes'?nodes:table==='estate_memberships'?[{user_id:actor.id,estate_id:estate,status:'active'},{user_id:operator.id,estate_id:estate,status:'active'}]:[];const result=source.filter(r=>filters.every(f=>f(r))).slice(0,limit).map(r=>fields==='*'?structuredClone(r):Object.fromEntries(fields.split(',').map(k=>[k,r[k]??null])));return{data:single?result[0]||null:result,error:null}}return q}};
function stub(file,exports){const key=require.resolve(file);require.cache[key]={id:key,filename:key,loaded:true,exports}}
stub('../dist/supabase/supabaseClient.js',{supabaseAdmin:client});
stub('../dist/services/canonicalDevicePanelHydrationService.js',{hydrateCanonicalDevicePanel:()=>{throw Error('device path not allowed')}});
const {cameraCurrentState}=require('../dist/modules/cameras/cameraCurrentStateAuthority.js');
const {presentCameraRows,cameraStateCounts,cameraStatePresentation}=require('../dist/modules/cameras/cameraCurrentStatePresentation.js');
const {canAccessCamera}=require('../dist/modules/cameras/cameraAccess.policy.js');
const controllers=require('../dist/controllers/camerasController.js');
const {hydrateCanonicalTarget}=require('../dist/oyi-core/runtime/canonicalTargetHydrationRegistry.js');
const {summarizeModuleToolForTest}=require('../dist/ai/commandRouter.js');
const {objectStateLine}=require('../dist/oyi-core/presentation/objectFallbackPresentation.js');
function observation(kind,source,result,age=1000){return{schema_version:1,observation_id:`00000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`,camera_id:id,edge_node_id:'edge-a',kind,source,result,observed_at:iso(age),received_at:iso(age-100),details:kind==='frame'&&result==='acquired'?{validation:'bounded_image_signature',mime_type:'image/jpeg',size_bytes:4}:kind==='inference'?{detection_count:0}:{}}}
const frame=(result='acquired',age=1000)=>observation('frame','ai_snapshot',result,age);
function camera(...obs){return{...base,runtime_observations:{version:1,dimensions:Object.fromEntries(obs.map(o=>[`${o.kind}:${o.source}`,{latest:o,...(o.kind==='frame'&&o.result==='acquired'?{last_success:o}:{})}]))}}}
function response(){return{statusCode:200,status(v){this.statusCode=v;return this},json(v){this.body=v;return this}}}
function req(user=actor){return{user,params:{estateId:estate,homeId:'home-a'},query:{},body:{}}}
const expired={...node,heartbeat_observed_at:iso(300000),heartbeat_received_at:iso(299900)};
const cases=[
 ['healthy',camera(frame()),node],
 ['degraded',camera(frame(),observation('inference','external_detector','failed')),node],
 ['healthy',camera(frame(),observation('reachability','onvif_probe','failed')),node], // unspecified probe cadence: preserve frozen result
 ['unknown',camera(frame('acquired',300000)),expired],
 ['degraded',camera(frame()),expired],
 ['unavailable',camera(frame('failed')),node],
 ['unknown',camera(observation('stream_configuration','go2rtc_registry','configured')),node],
 ['unknown',{...base},node],
 ['unavailable',{...camera(frame('failed')),status:'online'},node],
 ['healthy',{...camera(frame()),status:'offline',camera_infrastructure:{health_state:'offline'}},node],
];
for(const [expected,c,n] of cases){
 rows=[c];nodes=[n];const state=cameraCurrentState(c,actor,n,{now});assert.equal(state.overall,expected);
 const resident=(await presentCameraRows(rows,actor,{now}))[0],facility=(await presentCameraRows(rows,operator,{now}))[0];
 assert.deepEqual(facility.current_state,state);assert.deepEqual(resident.current_state,cameraStatePresentation(state));
 assert.equal(resident.current_state.frame.freshness,state.frame.freshness);assert.equal(resident.current_state.observedAt,state.observedAt);
 assert.equal('evidence' in resident.current_state.frame,false);assert.equal('details' in resident.current_state.frame,false);
 assert.ok(!JSON.stringify(resident).includes('DO_NOT_EXPOSE'));assert.equal('runtime_observations' in facility,false);assert.equal('health_transition_checkpoint' in facility,false);
 for(const handler of [controllers.listByHome,controllers.listByEstate]){const out=response();await handler(req(),out);assert.equal(out.statusCode,200);assert.equal(out.body.items[0].current_state.overall,expected)}
 const out=response();await controllers.inventoryByEstate(req(),out);assert.equal(out.body.cameras[0].current_state.overall,expected);assert.equal(out.body.summary[`${expected}_count`],1);assert.equal(out.body.summary.offline_streams,expected==='unavailable'?1:0);
 const hydrated=await hydrateCanonicalTarget({actor,oisContext:{estate_id:estate,home_id:'home-a'},target:{objectType:'camera',objectId:id,ambiguous:false},activeContext:null,visibleState:null});
 assert.equal(hydrated.status,'hydrated',JSON.stringify(hydrated));assert.equal(hydrated.object.current_state,expected);assert.equal(hydrated.object.metadata.current_state.overall,expected);
 assert.ok(objectStateLine(hydrated.object).includes(hydrated.object.metadata.explanation));
 const module=await summarizeModuleToolForTest(operator,'show cameras',{module:'cameras',__oyi_surface:'facility'});
 const entity=module.data.conversation_entities.find(e=>e.id===id);assert.equal(entity.details.current_state.overall,expected);assert.equal(entity.status,expected);
}
console.log('PASS A-J frozen truth across adapter, Facility/direct API, Consumer, Camera Center counts and conversation hydration');
rows=[camera(frame())];nodes=[node];
for(const role of ['resident','facility_manager','security_operator','security','estate_admin','ochiga_admin','admin'])for(const home of ['home-a','home-b'])for(const scope of ['home','facility'])for(const cameraEstate of [estate,'cross-estate']){
 const c={...rows[0],home_id:home,privacy_scope:scope,estate_id:cameraEstate},a={...actor,role};rows=[c];
 assert.equal((await presentCameraRows(rows,a,{now})).length,canAccessCamera(c,a).ok?1:0);
}
console.log('PASS actual canonical role/Home/estate privacy matrix, no invented alias privileges');
for(const count of [1,10,50,100]){
 rows=Array.from({length:count},(_,i)=>{const c=camera(frame());c.id=`camera-${i}`;for(const slot of Object.values(c.runtime_observations.dimensions)){slot.latest.camera_id=c.id;slot.last_success.camera_id=c.id}return c});nodes=[node];queries=[];
 const projected=await presentCameraRows(rows,actor,{now});assert.equal(projected.length,count);assert.equal(queries.length,2);assert.deepEqual(queries.map(q=>q.table),['facility_cameras','edge_nodes']);assert.equal(cameraStateCounts(projected).healthy_count,count);
 queries=[];const out=response();await controllers.inventoryByEstate(req(),out);assert.equal(out.body.summary.healthy_count,count);assert.ok(queries.length<=5,'inventory bounded reads');
}
console.log('PASS 1/10/50/100 bounded canonical + Edge batch reads, no history/provider calls/writes');
for(const file of ['src/services/spatialFacilityContextService.ts','src/services/platformGapService.ts','src/ai/commandRouter.ts','src/oyi-core/runtime/canonicalTargetHydrationRegistry.ts'])assert.match(readFileSync(file,'utf8'),/presentCameraRows/);
assert.doesNotMatch(readFileSync('src/services/platformGapService.ts','utf8').split('async cameraInfrastructure')[1].split('async upsertCameraInfrastructure')[0],/health_state:\s*row\.health_state/);
assert.doesNotMatch(readFileSync('src/routes/officeExport.ts','utf8'),/live_cameras\s*\+=/);
console.log('PASS supplementary wiring guards (not a substitute for route integration regressions)');
