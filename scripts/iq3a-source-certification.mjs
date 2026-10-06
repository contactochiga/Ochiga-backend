import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import path from 'node:path';
assert.equal(process.env.SUPABASE_URL,'http://127.0.0.1:55421');
const require=createRequire(import.meta.url);
for(const pkg of ['bullmq','ioredis']){const p=require.resolve(pkg);class Inert{on(){return this;}quit(){return Promise.resolve();}}Inert.default=Inert;Inert.Redis=Inert;Inert.Queue=Inert;Inert.Worker=Inert;require.cache[p]={id:p,filename:p,loaded:true,exports:Inert};}
globalThis.fetch=async()=>{throw Error('SOURCE_TEST_NETWORK_FORBIDDEN');};
const {ensureRegistered}=await import('../dist/oyi-core/orchestration/ConversationOrchestrator.js');
const {capabilityRegistry}=await import('../dist/oyi-core/capabilities/CapabilityRegistry.js');
const {capabilityService}=await import('../dist/oyi-core/capabilities/CapabilityService.js');
const {supabaseAdmin:db}=await import('../dist/supabase/supabaseClient.js');
ensureRegistered();
const source=fs.readFileSync('scripts/wave11-behavioural-torture-harness.mjs','utf8');
const {actorFor,oisContext}=new Function(`${source.slice(source.indexOf('const ids = '),source.indexOf('function expected(prompt)'))};return {actorFor,oisContext};`)();
const context=(surface,role)=>{const actor=actorFor(role,surface),ois=oisContext(actor,surface);return{actor,oisContext:ois,input:{surface,message:'Read authorised source',estate_id:ois.estate_id,home_id:ois.home_id,context:{}},resolvedTurn:{request_id:'source-certification',scope:{estate_id:ois.estate_id,home_id:ois.home_id,building_id:null,room_id:null},semantic_frame:{normalizedText:'Read source'},operation:'list'},legacyFallback:async()=>{throw Error('NO_FALLBACK');}};};
const resident=context('consumer','resident'),facility=context('facility','facility_manager');
const homeA=resident.oisContext.home_id,homeB=actorFor('resident_b','consumer').home_id;
let queryCount=0,mode='normal',delay=0;
const original=db.from;
const rows=()=>[
 {id:'a-request',estate_id:resident.oisContext.estate_id,home_id:homeA,room_id:null,title:'A only',visitor_name:'A visitor',status:'open',priority:'high',created_at:'2026-10-04T00:00:00Z',updated_at:'2026-10-04T00:00:00Z',opened_at:'2026-10-04T00:00:00Z'},
 {id:'b-request',estate_id:resident.oisContext.estate_id,home_id:homeB,room_id:null,title:'B distinctive',visitor_name:'B distinctive',status:'resolved',created_at:'2026-10-04T00:00:00Z',updated_at:'2026-10-04T00:00:00Z',opened_at:'2026-10-04T00:00:00Z'},
];
const results=[];
const check=(id,fn)=>fn().then(()=>results.push({id,status:'PASS'})).catch(error=>{error.message=`${id}: ${error.message}`;throw error;});
try{
 db.from=table=>{
  assert(['maintenance_requests','facility_incidents','visitor_access'].includes(table));queryCount++;
  const filters=[];let limit;
  const q={select(){return q;},order(){return q;},eq(k,v){filters.push([k,v]);return q;},limit(n){limit=n;return q;},then(resolve,reject){
   assert.equal(limit,50);assert(filters.some(([k])=>k==='home_id'||k==='estate_id'));
   let data=mode==='empty'?[]:mode==='b-only'?[rows()[1]]:mode==='many'?Array.from({length:60},(_,i)=>({...rows()[0],id:String(i)})):rows();
   data=data.filter(r=>filters.every(([k,v])=>r[k]===v)).slice(0,limit);
   return new Promise(r=>setTimeout(()=>r({data:mode==='error'?null:data,error:mode==='error'?{message:'synthetic source error'}:null}),delay)).then(resolve,reject);
  }};return q;
 };
 for(const key of ['maintenance.requests.read','security.incidents.read','visitors.pending.read']){
  await check(`${key}:resident-a`,async()=>{mode='normal';const r=await capabilityService.readEvidence(key,resident);assert.equal(r.record_count,1);assert.equal(r.complete,false);assert(!JSON.stringify(r).includes('b-request'));assert(!JSON.stringify(r).includes('B distinctive'));});
  await check(`${key}:other-home-does-not-change-zero`,async()=>{mode='b-only';const r=await capabilityService.readEvidence(key,resident);assert.equal(r.status,'available_zero');assert.equal(r.zero_proven,true);assert.equal(r.source_total,null);});
  await check(`${key}:cross-home-request`,async()=>{const n=queryCount;const r=await capabilityService.readEvidence(key,{...resident,input:{...resident.input,home_id:homeB}});assert.equal(r.status,'authority_denied');assert.equal(queryCount,n);assert.equal(r.record_count,0);});
  await check(`${key}:estate`,async()=>{mode='normal';const r=await capabilityService.readEvidence(key,facility);assert.equal(r.record_count,2);assert.equal(r.complete,false);});
  await check(`${key}:resolved-is-historical`,async()=>{mode='normal';const r=await capabilityService.readEvidence(key,facility);assert(r.lifecycle.some(x=>x.relevance==='historical'));});
  await check(`${key}:building-a-does-not-query-b`,async()=>{const n=queryCount;const r=await capabilityService.readEvidence(key,{...facility,input:{...facility.input,context:{building_id:'building-a'}}});assert.equal(r.status,'scope_unsupported');assert.equal(queryCount,n);assert.equal(r.record_count,0);});
  await check(`${key}:facility-home-not-estate`,async()=>{const n=queryCount;const r=await capabilityService.readEvidence(key,{...facility,oisContext:{...facility.oisContext,home_id:homeA},input:{...facility.input,home_id:homeA}});assert.equal(r.status,'scope_unsupported');assert.equal(queryCount,n);});
  await check(`${key}:error-not-zero`,async()=>{mode='error';const r=await capabilityService.readEvidence(key,resident);assert.equal(r.status,'unavailable');assert.equal(r.zero_proven,false);});
  await check(`${key}:truncation`,async()=>{mode='many';const r=await capabilityService.readEvidence(key,resident);assert.equal(r.record_count,50);assert.equal(r.truncated,true);assert.equal(r.complete,false);});
  await check(`${key}:late-result`,async()=>{mode='normal';delay=30;const r=await capabilityService.readEvidence(key,resident,5);assert.equal(r.status,'timeout');const snapshot=JSON.stringify(r);await new Promise(r=>setTimeout(r,45));assert.equal(JSON.stringify(r),snapshot);delay=0;});
  await check(`${key}:slow-within-deadline`,async()=>{mode='normal';delay=15;const r=await capabilityService.readEvidence(key,resident,500);assert.notEqual(r.status,'timeout');assert.equal(r.record_count,1);delay=0;});
  await check(`${key}:exact-target-not-silently-broad`,async()=>{const n=queryCount;const r=await capabilityService.readEvidence(key,{...resident,resolvedTurn:{...resident.resolvedTurn,target:{canonical_id:'a-request'}}});assert.equal(r.status,'scope_unsupported');assert.equal(queryCount,n);});
  await check(`${key}:public-denied`,async()=>{const n=queryCount;const r=await capabilityService.readEvidence(key,context('public_corporate','public'));assert.equal(r.status,'authority_denied');assert.equal(queryCount,n);});
 }
 const office=context('office_internal','ochiga_staff');
 const snapshotCases=[
  ['crm.leads.read','leads','needing_attention',{id:'lead-a',name:'Office A',status:'qualified',reason:'synthetic',last_activity_at:null}],
  ['crm.opportunities.read','opportunities','stale',{id:'opp-a',name:'Office A',stage:'review',days_since_activity:21,owner:null}],
  ['reports.approvals.read','reports','pending_approval',{id:'report-a',title:'Office A',submitted_by:null,submitted_at:null}],
  ['development.status.read','development','projects',{id:'project-a',name:'Office A',status:'planning'}],
  ['financial.summary.read','financial','estates',{estate_id:'estate-a',name:'Office A'}],
  ['office_tasks.query.read','tasks','open',{id:'task-a',title:'Task A',status:'open',overdue:false}],
  ['office_automations.query.read','automations','items',{id:'automation-a',name:'Automation A',enabled:true}],
  ['office_meetings.query.read','meetings','items',{id:'meeting-a',title:'Meeting A',status:'scheduled'}],
  ['office_support.query.read','support','items',{id:'support-a',title:'Support A',status:'open'}],
  ['office_portfolio.query.read','portfolio','items',{id:'portfolio-a',name:'Portfolio A',status:'attention'}],
  ['office_partnerships.query.read','partnerships','items',{id:'partnership-a',name:'Partnership A',status:'active'}],
  ['office_documents.query.read','documents','items',{id:'document-a',title:'Document A',status:'draft'}],
  ['office_content.query.read','content','items',{id:'content-a',title:'Content A',status:'draft'}],
 ];
 for(const [key,field,list,item]of snapshotCases){
  // Synthetic authorised principal for this module; narrower-role cases below
  // separately exercise the real policy without these explicit grants.
  office.actor.permissions=[...new Set([...office.actor.permissions,...capabilityRegistry.get(key).permission_requirements])];
  const withRows=items=>({...office,input:{...office.input,context:{operational_snapshot:{[field]:{[list]:items,total_open:39}}}}});
  await check(`${key}:snapshot-absent`,async()=>{const n=queryCount;const r=await capabilityService.readEvidence(key,office);assert.equal(r.status,'unavailable');assert.equal(r.zero_proven,false);assert.equal(queryCount,n);});
  await check(`${key}:snapshot-empty-not-global-zero`,async()=>{const r=await capabilityService.readEvidence(key,withRows([]));assert.equal(r.status,'available_partial');assert.equal(r.zero_proven,false);});
  await check(`${key}:snapshot-bounded`,async()=>{const n=queryCount;const r=await capabilityService.readEvidence(key,withRows(Array.from({length:60},(_,i)=>({...item,id:`item-${i}`}))));assert.equal(r.record_count,50);assert.equal(r.complete,false);assert.equal(r.truncated,true);assert.equal(r.freshness,'unknown');assert.equal(queryCount,n);});
  await check(`${key}:public-cannot-use-snapshot`,async()=>{const c=context('public_corporate','public');const r=await capabilityService.readEvidence(key,{...c,input:{...c.input,context:withRows([item]).input.context}});assert.equal(r.status,'authority_denied');assert.equal(r.record_count,0);});
  await check(`${key}:ordinary-staff-permission`,async()=>{const c=context('office_internal','ochiga_staff');c.actor.permissions=[];c.actor.permission_scopes=[];c.oisContext.permissions=[];const allowed=capabilityService.canUse(key,{actor:c.actor,oisContext:c.oisContext,surface:'office_internal'}).allowed;const r=await capabilityService.readEvidence(key,c);assert.equal(r.status,allowed?'unavailable':'authority_denied');assert.equal(r.record_count,0);});
  await check(`${key}:no-actor-denied`,async()=>{const r=await capabilityService.readEvidence(key,{...withRows([item]),actor:null});assert.equal(r.status,'authority_denied');assert.equal(r.record_count,0);});
  await check(`${key}:malformed-section-not-zero`,async()=>{const r=await capabilityService.readEvidence(key,withRows({total:0}));assert.equal(r.status,'unavailable');assert.equal(r.zero_proven,false);});
  await check(`${key}:building-scope-not-snapshot`,async()=>{const c=withRows([item]);c.input.context.building_id='building-a';const r=await capabilityService.readEvidence(key,c);assert.equal(r.status,'scope_unsupported');assert.equal(r.record_count,0);});
  await check(`${key}:mismatched-actor-context`,async()=>{const c=withRows([item]);c.oisContext={...c.oisContext,actor_id:'different-actor'};const r=await capabilityService.readEvidence(key,c);assert.equal(r.status,'authority_denied');assert.equal(r.record_count,0);});
  if(key.startsWith('office_'))await check(`${key}:lifecycle-not-invented`,async()=>{const r=await capabilityService.readEvidence(key,withRows([{...item,status:'completed',workflow_status:'completed'}]));assert.equal(r.freshness,'unknown');assert.equal(r.lifecycle[0].relevance,key==='office_automations.query.read'?'unknown':'historical');});
  const filter={
   'office_tasks.query.read':['show overdue tasks',{overdue:true},{overdue:false}],
   'office_automations.query.read':['show active automations',{enabled:true},{enabled:false}],
   'office_meetings.query.read':['show meetings today',{scheduled_at:new Date().toISOString()},{scheduled_at:'2001-01-01T00:00:00Z'}],
   'office_support.query.read':['show critical support cases',{severity:'critical'},{severity:'low'}],
   'office_portfolio.query.read':['show at risk portfolio entries',{status:'attention'},{status:'healthy'}],
  }[key];
  if(filter){
   await check(`${key}:module-filter-retained`,async()=>{const [message,yes,no]=filter;const c=withRows([{...item,...yes,id:'included'},{...item,...no,id:'excluded'}]);c.input.message=message;const r=await capabilityService.readEvidence(key,c);assert.deepEqual(r.records.map(x=>x.object_id),['included']);assert.equal(r.complete,false);assert.equal(r.zero_proven,false);});
   await check(`${key}:filtered-empty-not-universal-zero`,async()=>{const [message,,no]=filter;const c=withRows([{...item,...no,id:'excluded'}]);c.input.message=message;const r=await capabilityService.readEvidence(key,c);assert.equal(r.record_count,0);assert.equal(r.status,'available_partial');assert.equal(r.zero_proven,false);});
  }
 }
 // Public cannot obtain Office sources through this new collection boundary.
 for(const module of capabilityRegistry.all().filter(m=>m.supported_surfaces?.includes('office_internal')&&!m.supported_surfaces?.includes('public_corporate'))){
  await check(`${module.key}:osa-denied`,async()=>{const n=queryCount;assert.equal((await capabilityService.readEvidence(module.key,context('public_corporate','public'))).status,'authority_denied');assert.equal(queryCount,n);});
 }
 for(const module of capabilityRegistry.all().filter(m=>!m.evidence_read)){
  await check(`${module.key}:uncertified-not-collected`,async()=>{
   const surface=module.supported_surfaces?.[0]||'consumer';
   const role={consumer:'resident',facility:'facility_manager',office_internal:'ochiga_staff',public_corporate:'public'}[surface]||'resident';
   const n=queryCount;const result=await capabilityService.readEvidence(module.key,context(surface,role));
   assert(['scope_unsupported','authority_denied'].includes(result.status));assert.equal(result.record_count,0);assert.equal(queryCount,n);
  });
 }
 const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):e.name.endsWith('.ts')?[path.join(dir,e.name)]:[]);
 const sources=walk('src/oyi-core').map(p=>({path:p,text:fs.readFileSync(p,'utf8')}));
 const sourceInspection=m=>{
  const origins=sources.filter(s=>s.text.includes(`"${m.key}"`)||s.text.includes(`'${m.key}'`));
  const body=m.collectEvidence.toString();
  return{collector_body:body,origins:origins.map(s=>({path:s.path,sha256:createHash('sha256').update(s.text).digest('hex')})),
   query_indicators:origins.flatMap(s=>[...s.text.matchAll(/\.from\(["']([^"']+)["']\)/g)].map(x=>({module:s.path,table:x[1]}))),
   bound_indicators:origins.flatMap(s=>[...s.text.matchAll(/\.limit\((\d+)\)/g)].map(x=>({module:s.path,limit:Number(x[1])}))),
   note:'Mechanically derived implementation/source indicators; whole-module indicators are not claims that every listed query belongs to this collector. Uncertified sources remain uncallable.'};
 };
 const inventory=capabilityRegistry.all().filter(m=>m.risk_class==='read').map(m=>({
  collector_id:m.key,capability_key:m.key,domain:m.domain,surfaces:m.supported_surfaces,
  permissions:m.permission_requirements,required_scope:m.scope_requirements,
  authority_path:'CapabilityService.readEvidence -> canUse -> verified actor/scope -> source -> assertEvidenceAllowed',
  state:m.evidence_read?'CERTIFIED_PARTIAL':m.rolloutStatus!=='enabled'?'NOT_ELIGIBLE_OTHER':'NOT_ELIGIBLE_COMPLETENESS',planner_eligible:Boolean(m.evidence_read),
  planner_block_reason:m.evidence_read?null:m.rolloutStatus!=='enabled'?`Capability rollout is ${m.rolloutStatus}; no enabled certified source.`:'No opted-in source outcome proof; collectEvidence array alone does not certify availability/completeness/scope.',
  source_module:m.evidence_read?.source_module||null,source_sha256:m.evidence_read?createHash('sha256').update(fs.readFileSync(m.evidence_read.source_module)).digest('hex'):null,
  query:m.evidence_read?.kind==='office_snapshot'?'supplied operational_snapshot; no DB query':m.evidence_read?m.key.startsWith('maintenance')?'maintenance_requests':m.key.startsWith('security')?'facility_incidents':'visitor_access':null,
  requested_scope:m.evidence_read?.kind==='office_snapshot'?'Verified Office actor, permission-gated supplied snapshot only':m.evidence_read?'Consumer verified estate/home; Facility verified estate; building/room rejected':null,
  effective_scope:m.evidence_read?.kind==='office_snapshot'?'Same supplied Office snapshot; operational scope requests rejected':m.evidence_read?'Same as admitted scope; Facility home restriction rejected':null,
  supported_scope_dimensions:m.evidence_read?.kind==='office_snapshot'?['supplied Office snapshot']:m.evidence_read?['estate (Facility only)','home (Consumer only)']:[],
  filters_enforced:m.evidence_read?.kind==='office_snapshot'?'Existing source section; no backend Office query':m.evidence_read?'Facility estate_id; Consumer home_id; security also estate_id':null,
  result_bound:m.evidence_read?.source_limit||null,pagination:m.evidence_read?'None; non-empty conservatively partial':null,
  truncation_detection:m.evidence_read?'50 records -> truncated; below 50 still incomplete':null,
  zero_proof:m.evidence_read?.kind==='office_snapshot'?'Never global zero; missing section unavailable, empty present section partial':m.evidence_read?'Successful empty query after verified scope admission; unavailable sentinel never zero':null,
  completeness:m.evidence_read?.kind==='office_snapshot'?'Always partial; total_open is not the supplied subset':m.evidence_read?'Only empty admitted successful population query proves zero; non-empty partial':null,
  availability:m.evidence_read?'Source error sentinel -> unavailable; thrown exception -> error':null,
  freshness:m.evidence_read?.kind==='office_snapshot'?'Unknown; no canonical source TTL contract; observed_at retained without promotion':m.evidence_read?'Existing per-record source freshness preserved; non-empty source freshness unknown; empty successful query current':null,
  lifecycle:m.evidence_read?'Explicit status values only; resolved/closed/completed/cancelled/expired historical; open/pending/in_progress/acknowledged/expected/approved/active active; otherwise unknown':null,
  timeout:m.evidence_read?'2-second default acceptance deadline; tested late discard':null,cancellation:m.evidence_read?'Not supported by these collectors; underlying read may finish':null,
  audit_complete:Boolean(m.evidence_read),
  implementation_inspection:sourceInspection(m),
 }));

 // Descriptions for the sources certified in the benchmark-required closure. These mirror the
 // adapters under src/oyi-core/evidence/sources and are proven by iq3a-benchmark-source-tests.mjs.
 const T0={timeout:'2-second default acceptance deadline; late result discarded (tested)',cancellation:'Not supported by these collectors; underlying read may finish'};
 const NEW={
  'devices.status.read':{query:'devices (limit 100) + rooms names + device_states cache-first hydration',requested_scope:'Consumer verified home, optionally one membership-verified room; Facility rejected (home-only source)',effective_scope:'Same home (and room), enforced in the query',supported_scope_dimensions:['home (Consumer)','room (Consumer, membership verified)'],filters_enforced:'home_id; room_id pushed into the query, never applied after the row limit',result_bound:100,pagination:'None; below the bound the registered-device population is complete',truncation_detection:'100 rows -> truncated, never complete',zero_proof:'Successful home/room query with no rows; an empty room also needs a rooms row for the verified home',completeness:'Complete below the bound for the registered population; per-device state is reported as observed (unobservable/unknown/stale)',availability:'Query or state-hydration failure -> error; room not in home -> scope_insufficient; never an empty list',freshness:'Registry current; each record carries its own observation freshness; unobserved devices are unobservable',lifecycle:'No lifecycle states'},
  'devices.activity.read':{query:'ai_execution_ledger (limit 25) for the verified home since the declared window (default 6h)',requested_scope:'Consumer verified home only; room, Facility and exact-object rejected',effective_scope:'Same home, enforced in the query',supported_scope_dimensions:['home (Consumer)'],filters_enforced:'home_id; window start; audit events and caller-supplied history are NOT sources',result_bound:25,pagination:'None; window + bound',truncation_detection:'25 ledger rows -> truncated',zero_proof:'Successful ledger query, fewer than 25 rows, no visible executions in the declared window',completeness:'Complete only below the bound for the visible population in the window',availability:'Ledger failure -> error (mandatory sub-source); name/room enrichment failure -> degraded partial',freshness:'Past events are history; read time current',lifecycle:'Records marked historical'},
  'devices.failures.read':{query:'Same bounded ledger read; failure facts only',requested_scope:'Consumer verified home only',effective_scope:'Same home, enforced in the query',supported_scope_dimensions:['home (Consumer)'],filters_enforced:'home_id; window; failure predicate applied after the bounded read',result_bound:25,pagination:'None; window + bound',truncation_detection:'25 ledger rows -> truncated (older failures may exist)',zero_proof:'Successful ledger query below the bound with no visible failures in the window',completeness:'Complete only below the bound',availability:'Ledger failure -> error',freshness:'Past events are history',lifecycle:'Records marked historical'},
  'facility.cameras.read':{query:'facility_cameras (limit 100) then canonical camera current-state authority',requested_scope:'Facility verified estate only; building, home, room and Consumer rejected',effective_scope:'Same estate; camera access policy filters per camera',supported_scope_dimensions:['estate (Facility)'],filters_enforced:'estate_id; camera privacy policy (home-private cameras excluded)',result_bound:100,pagination:'None; bound applies before the access policy',truncation_detection:'100 registry rows -> truncated (accessible cameras may be missing)',zero_proof:'Registry query ok, below the bound, no accessible cameras',completeness:'Complete below the bound for accessible cameras; video state is never inferred',availability:'Registry or state-resolution failure -> error; unknown video state stays unobservable, never offline',freshness:'Per-camera canonical freshness; unknown state is unobservable',lifecycle:'No lifecycle states'},
  'scenes.list.read':{query:'consumer_scenes (limit 50)',requested_scope:'Consumer verified home; room, Facility and public rejected',effective_scope:'Same home, enforced in the query',supported_scope_dimensions:['home (Consumer)'],filters_enforced:'home_id',result_bound:50,pagination:'None; non-empty conservatively partial',truncation_detection:'50 records -> truncated',zero_proof:'Successful home query with no rows; failure sentinel never zero',completeness:'Non-empty is conservatively partial',availability:'Source error sentinel -> unavailable',freshness:'Current configuration read',lifecycle:'Explicit status only'},
  'corporate.partnerships.read':{query:'Governed knowledge item backend:corporate-partnerships via deterministic canonical-key lookup',requested_scope:'Public Osa/Oma surface only; no estate/home/thread scope',effective_scope:'PUBLIC audience ceiling, agent oma',supported_scope_dimensions:['public corporate'],filters_enforced:'Audience ceiling and agent visibility on the item',result_bound:1,pagination:'Single item',truncation_detection:'Not applicable',zero_proof:'Index healthy and no authorised item; hidden and absent are indistinguishable by design',completeness:'Single governed item',availability:'Retrieval failure -> error; degraded index -> unavailable; in-code fallback copy is never evidence',freshness:'Governed does not mean verified current: unknown',lifecycle:'No lifecycle states',provenance:'canonical key, domain, authority class, audience, worker visibility, freshness class, claim boundary, version, source family; no file paths'},
  'corporate.development.read':{query:'Public Sanity CDN development project listing (GET, no credentials)',requested_scope:'Public surface only',effective_scope:'Public dataset',supported_scope_dimensions:['public corporate'],filters_enforced:'Published developmentProject documents',result_bound:50,pagination:'None; larger lists truncated at 50',truncation_detection:'>50 projects -> truncated',zero_proof:'Never proven current zero (CDN gives no freshness guarantee)',completeness:'Complete only for a healthy provider response within the bound',availability:'HTTP failure/malformed body -> unavailable; timeout -> timeout; network -> error; never an empty listing',freshness:'Unknown',lifecycle:'Published status reported by the provider'},
  'corporate.opportunity.read':{query:'oyi_conversation_threads.metadata.public_opportunity_objective for the caller-owned public thread',requested_scope:'Public thread owned by the caller (user_id and surface proven); no estate/home scope',effective_scope:'One public thread',supported_scope_dimensions:['public thread'],filters_enforced:'thread id + surface public_corporate + user_id === actor',result_bound:1,pagination:'Single object',truncation_detection:'Not applicable',zero_proof:'Owned thread with no unexpired objective',completeness:'Single caller-supplied object',availability:'Query failure -> error; other caller thread -> authority_denied; missing thread -> scope_insufficient',freshness:'30-minute product TTL; caller-supplied and unverified (truth class user_assertion)',lifecycle:'Expired objective is no current objective'},
 };
 for(const r of inventory){if(NEW[r.capability_key])Object.assign(r,NEW[r.capability_key],T0,{audit_complete:true});const m=capabilityRegistry.get(r.capability_key);if(m.evidence_read){r.certified_scopes=m.evidence_read.scopes;r.evidence_read_kind=m.evidence_read.kind;}}
 // Planner readiness is computed from the frozen blocker graph by scripts/iq3a-final-readiness.mjs.
 const readiness=[];
 const certified=inventory.filter(r=>r.planner_eligible).length;
 fs.writeFileSync('artifacts/intelligence-quality-v1-evidence-source-inventory.json',JSON.stringify({status:'PARTIAL_CERTIFICATION_INVENTORY',collector_count:inventory.length,source_audits_complete:certified,records:inventory},null,2)+'\n');
 fs.writeFileSync('artifacts/intelligence-quality-v1-evidence-certification.json',JSON.stringify({status:'IQ-3A NOT YET CERTIFIED',test_mode:'Actual collectors with isolated deterministic query fault injection; not a live database cross-home certification',results,readiness},null,2)+'\n');
 console.log(JSON.stringify({status:'PASS',tests:results.length,certified_partial:certified,inventory:inventory.length,readiness_blocked:readiness.length}));
}finally{db.from=original;}
