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
const check=(id,fn)=>fn().then(()=>results.push({id,status:'PASS'}));
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
 ];
 for(const [key,field,list,item]of snapshotCases){
  const withRows=items=>({...office,input:{...office.input,context:{operational_snapshot:{[field]:{[list]:items,total_open:39}}}}});
  await check(`${key}:snapshot-absent`,async()=>{const n=queryCount;const r=await capabilityService.readEvidence(key,office);assert.equal(r.status,'unavailable');assert.equal(r.zero_proven,false);assert.equal(queryCount,n);});
  await check(`${key}:snapshot-empty-not-global-zero`,async()=>{const r=await capabilityService.readEvidence(key,withRows([]));assert.equal(r.status,'available_partial');assert.equal(r.zero_proven,false);});
  await check(`${key}:snapshot-bounded`,async()=>{const n=queryCount;const r=await capabilityService.readEvidence(key,withRows(Array.from({length:60},(_,i)=>({...item,id:`item-${i}`}))));assert.equal(r.record_count,50);assert.equal(r.complete,false);assert.equal(r.truncated,true);assert.equal(r.freshness,'unknown');assert.equal(queryCount,n);});
  await check(`${key}:public-cannot-use-snapshot`,async()=>{const c=context('public_corporate','public');const r=await capabilityService.readEvidence(key,{...c,input:{...c.input,context:withRows([item]).input.context}});assert.equal(r.status,'authority_denied');assert.equal(r.record_count,0);});
  await check(`${key}:ordinary-staff-permission`,async()=>{const c=context('office_internal','ochiga_staff');c.actor.permissions=[];c.actor.permission_scopes=[];c.oisContext.permissions=[];const r=await capabilityService.readEvidence(key,c);assert.equal(r.status,'authority_denied');});
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
 const pre=JSON.parse(fs.readFileSync('artifacts/intelligence-quality-v1-iq3-preimplementation-audit.json'));
 const readiness=pre.records.filter(r=>r.classification==='EVIDENCE_PLANNING').map(r=>{
  const candidates=r.candidate_capabilities.filter(c=>c.authority.allowed);
  const required=r.required_evidence_domains;
  const missing=required.filter(d=>!candidates.some(c=>c.evidence_requirements.some(e=>e.domain===d)));
  const absent=missing.filter(d=>!capabilityRegistry.all().some(c=>c.risk_class==='read'&&c.evidence_requirements?.some(e=>e.domain===d)));
  const uncertified=candidates.filter(c=>!capabilityRegistry.get(c.key)?.evidence_read).map(c=>c.key);
  const unsupportedSubject=Boolean(r.assessment?.subject_label||r.assessment?.target_ref);
  const covered=required.length>0&&!missing.length&&candidates.length>0&&!uncertified.length&&!unsupportedSubject;
  return{id:r.id,status:covered?'PLANNER_READY_PARTIAL':absent.length?'MISSING_CAPABILITY':'SOURCE_CONTRACT_BLOCKED',
   required_domains:required,candidate_sources:candidates.map(c=>c.key),uncertified_sources:uncertified,missing_domains:missing,
   absent_capability_domains:absent,
   unresolved_or_exact_subject:unsupportedSubject,
   reason:covered?'All eligible matching source contracts are certified partial; this does not establish evidence sufficiency or assessment completion.':absent.length?'No registered read source declares the required evidence domain.':'At least one source lacks certification/eligibility, or no explicit admissible evidence requirement exists.',
  };
 });assert.equal(readiness.length,133);
 const certified=inventory.filter(r=>r.planner_eligible).length;
 fs.writeFileSync('artifacts/intelligence-quality-v1-evidence-source-inventory.json',JSON.stringify({status:'PARTIAL_CERTIFICATION_INVENTORY',collector_count:inventory.length,source_audits_complete:certified,records:inventory},null,2)+'\n');
 fs.writeFileSync('artifacts/intelligence-quality-v1-evidence-certification.json',JSON.stringify({status:'IQ-3A NOT YET CERTIFIED',test_mode:'Actual collectors with isolated deterministic query fault injection; not a live database cross-home certification',results,readiness},null,2)+'\n');
 console.log(JSON.stringify({status:'PASS',tests:results.length,certified_partial:certified,inventory:inventory.length,readiness_blocked:readiness.length}));
}finally{db.from=original;}
