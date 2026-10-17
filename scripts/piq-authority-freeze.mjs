// Preparation only: evaluate existing permission contracts without a Core turn.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const source=fs.readFileSync('scripts/iq8f-run.mjs','utf8');
const setup=source.slice(0,source.indexOf('// IQ-8F certification runner:')).replaceAll("'../dist/",`'${process.cwd()}/dist/`);
const code=String.raw`
unscripted();
require(process.cwd()+'/dist/oyi-core/orchestration/ConversationOrchestrator.js').ensureRegistered();
const {capabilityService}=require(process.cwd()+'/dist/oyi-core/capabilities/CapabilityService.js');
const actors=[];
for(const [worker,surface,role]of [['oma','office_internal','ochiga_staff'],['osa','public_corporate','public'],['facility','facility','facility_manager'],['consumer','consumer','resident']]){
 for(const variant of ['default','denied',...(['facility','consumer'].includes(worker)?['visitor_denied']:[]),...(worker==='consumer'?['resident_b']:[])]){
  let a=actorFor(variant==='resident_b'?'resident_b':role,surface);if(variant==='denied')a={...a,role:'guest',permissions:[],permission_scopes:[]};
  if(variant==='visitor_denied')a={...a,role:'maintenance_operator',permissions:[],permission_scopes:[]};
  const context=oisContext(a,surface);
  if(variant==='visitor_denied')assert.equal(capabilityService.canUse('visitors.pending.read',{actor:a,oisContext:context,surface}).allowed,false);
  actors.push({worker,variant,actor:Object.fromEntries(['id','role','estate_id','home_id','permissions','permission_scopes'].map(k=>[k,a[k]??null])),scope:{estate_id:context.estate_id,home_id:context.home_id},available_capabilities:capabilityService.listForActor({actor:a,oisContext:context,surface})});
 }
}
const resident=actorFor('resident','consumer');
assert(actors.filter(a=>a.variant==='default').every(a=>a.available_capabilities.length>0),'Registry inventory unavailable');
const m=await db.from('resident_memory').select('id,memory_type').eq('user_id',resident.id).gte('last_seen_at',new Date(Date.now()-30*24*60*60*1000).toISOString()).limit(100);
assert(!m.error);assert.equal(m.data.length,0,'Historical memory contamination requires fixture review before author execution');
fs.writeFileSync('artifacts/piq-20261016-authority.json',JSON.stringify({captured_at:new Date().toISOString(),actors,eligible_preexisting_resident_memory:0,empty_explicit_grants_do_not_revoke_role:true,denied_fixture_role:'guest'},null,2),{flag:'wx'});
console.log(JSON.stringify({actors:actors.length,eligible_preexisting_resident_memory:0,executed}));
`;
const r=spawnSync(process.execPath,['--input-type=module','-e',setup+code],{env:process.env,stdio:'inherit',timeout:30000});process.exitCode=r.status??1;
