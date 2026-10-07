process.env.SUPABASE_URL='http://x';process.env.SUPABASE_SERVICE_ROLE_KEY='x';process.env.SUPABASE_ANON_KEY='x';
import fs from 'node:fs'; import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
for (const pkg of ['bullmq','ioredis']) {const p=require.resolve(pkg); class Inert{on(){return this;} quit(){return Promise.resolve();}} Inert.default=Inert;Inert.Redis=Inert;Inert.Queue=Inert;Inert.Worker=Inert;require.cache[p]={id:p,filename:p,loaded:true,exports:Inert};}
(await import('/Users/ochigaidoko/Documents/oyi-intelligence-quality/dist/oyi-core/orchestration/ConversationOrchestrator.js')).ensureRegistered();
const {parseSemanticFrame}=await import('/Users/ochigaidoko/Documents/oyi-intelligence-quality/dist/oyi-core/interpretation/SemanticFrameParser.js');
const {capabilityRegistry}=await import('/Users/ochigaidoko/Documents/oyi-intelligence-quality/dist/oyi-core/capabilities/CapabilityRegistry.js');
const E=Object.fromEntries(JSON.parse(fs.readFileSync('/Users/ochigaidoko/Documents/oyi-intelligence-quality/artifacts/intelligence-quality-v1-iq9a-dev-expectations.json','utf8')).items.map(x=>[x.id,x]));
const score=(m,f)=>!m.supports(f)?0:(m.operations||[]).includes(f.operation)?100:m.domain===f.domain?25:10;
const out={};
for (const id of JSON.parse(process.argv[2])) {const e=E[id];const f=parseSemanticFrame(e.utterance,{surface:e.surface});const t=f.answerTarget;
 const c=capabilityRegistry.all().map(m=>({k:m.key,s:score(m,f),ok:!m.supported_surfaces?.length||m.supported_surfaces.includes(e.surface)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s).slice(0,3).map(x=>x.k+':'+x.s+(x.ok?'':'!surf'));
 out[id]={objective:f.cognitiveObjective||null,domain:f.domain,operation:f.operation,mutation:f.mutationIntent,target:{intent:t.response_intent,confirmation_kind:t.confirmation_kind||null,scope:t.subject_scope,yes_no:t.yes_no?.kind||null,ask_facet:t.ask_facet,clarify:t.clarify_reason||null,refusal:t.refusal_kind||null},candidates:c};}
fs.writeFileSync('/tmp/diag17.json',JSON.stringify(out,null,1));
