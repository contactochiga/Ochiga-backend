import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.SUPABASE_URL,'http://127.0.0.1:55421');
const require=createRequire(import.meta.url);
for(const pkg of ['bullmq','ioredis']){const p=require.resolve(pkg);class Inert{on(){return this;}quit(){return Promise.resolve();}}Inert.default=Inert;Inert.Redis=Inert;Inert.Queue=Inert;Inert.Worker=Inert;require.cache[p]={id:p,filename:p,loaded:true,exports:Inert};}
const fetchOriginal=globalThis.fetch;
globalThis.fetch=(input,options)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);assert(['127.0.0.1','localhost'].includes(u.hostname)&&u.port==='55421');return fetchOriginal(input,options);};
require('../dist/controllers/deviceCommandController.js').executeDeviceCommandForActor=async()=>{throw Error('EXEC_FORBIDDEN');};
const {conversationOrchestrator}=await import('../dist/oyi-core/orchestration/ConversationOrchestrator.js');
const source=fs.readFileSync('scripts/wave11-behavioural-torture-harness.mjs','utf8');
const {actorFor,oisContext,officeSnapshot}=new Function(`${source.slice(source.indexOf('const ids = '),source.indexOf('function expected(prompt)'))};return {actorFor,oisContext,officeSnapshot};`)();
const scenario=JSON.parse(fs.readFileSync('/tmp/iq5-scenario.json','utf8'));const scripts=scenario.scripts;
if(scenario.seam){process.env.OYI_JUDGMENT_TEST_SEAM='1';const {judgmentProviderTestSeam}=await import('../dist/oyi-core/evidence/judgment/provider.js');
 judgmentProviderTestSeam.provider={name:'scripted-test-provider',judge:async req=>{const q=c=>c.factors.some(f=>f.dimension==='readiness'&&f.level==='qualified')?0:1;
  const sorted=[...req.candidates].sort((a,b)=>q(a)-q(b));const n=req.requested_top_n||3;
  return {status:'ranked',ranking:sorted.slice(0,n).map((c,i)=>({cid:c.cid,rank:i+1,rationale:i===0?'it is recorded as qualified with supplied owner consent':'it is supported by its recorded stage and notes',supporting:[],counter:[],uncertainties:[]})),conclusion:'the order reflects recorded qualification and stage',uncertainties:['feasibility is not independently verified'],clarification:null};}};}
for(const [surface,role,prompts] of scripts){
 const actor=actorFor(role,surface);let thread=null;console.log('=====',surface);
 for(const prompt of prompts){const input={message:prompt,surface,thread_id:thread,estate_id:actor?.estate_id,home_id:actor?.home_id,context:{request_id:randomUUID(),...(surface==='office_internal'?{operational_snapshot:officeSnapshot()}:{})}};
  const r=await conversationOrchestrator.run({actor,oisContext:oisContext(actor,surface),input});thread=r.thread_id;
  console.log('>>',prompt);console.log('  ',r.execution?.assessment_status,r.capability_key||r.execution?.capability_key);console.log('  ',String(r.answer).slice(0,900));}
}
process.exit(0);
