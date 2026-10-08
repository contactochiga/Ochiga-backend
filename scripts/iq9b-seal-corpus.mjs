// Mechanical shape/coverage/hash checks, never semantic grading or rewriting.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const base='artifacts/intelligence-quality-v1-iq9b';
const sha=b=>createHash('sha256').update(b).digest('hex');
const norm=s=>String(s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const intents='LIST COUNT STATUS DETAIL VALUE_SUM YES_NO EXPLANATION COMPARISON_RANKING LIMITATION REFUSAL CONSTRAINT CLARIFICATION ACTION_CONFIRMATION SAFETY_RISK DISCOVERY FOLLOWUP_CONTEXT'.split(' ');
const boundaries='PRIVACY AUTHORITY ACTION_SAFETY CANCELLATION HONEST_LIMITATION SUBMISSION JUDGMENT_NO_PROVIDER CONTEXT_REFERENT'.split(' ');
const workers={Oma:'office_internal',Osa:'public_corporate',Facility:'facility',Consumer:'consumer'};
const items=[],expectations=[],composition={},files=['docs/INTELLIGENCE_QUALITY_V1_IQ9B_PROTOCOL.md','docs/INTELLIGENCE_QUALITY_V1_IQ9B_PROTOCOL_CLARIFICATION.md',base+'-author-packet.md',base+'-grader-instructions.md','scripts/iq9b-first-contact.mjs','scripts/iq9b-local-launch.mjs','scripts/iq9b-seal-corpus.mjs'];
for(const [worker,surface] of Object.entries(workers)){
 const path=base+'-author-'+worker+'.json';files.push(path);const a=JSON.parse(fs.readFileSync(path));assert.equal(a.worker,worker);assert.equal(a.surface,surface);assert.equal(a.authorship.prior_exposure,false);
 assert.equal(a.items.length,80);assert.equal(a.paraphrases.length,25);assert.equal(a.flips.length,25);
 assert(a.items.filter(i=>i.seeds.length>=2).length>=24,worker+' multi-turn coverage');
 for(const intent of intents)assert.equal(a.items.filter(i=>i.intent===intent).length,5,worker+' '+intent);
 for(const boundary of boundaries)assert(a.items.filter(i=>i.boundary.includes(boundary)).length>=2,worker+' '+boundary);
 const ids=new Set();for(const [field,kind] of [['items','primary'],['paraphrases','paraphrase'],['flips','flip']])for(const it of a[field]){
  assert(!ids.has(it.local_id));ids.add(it.local_id);assert(intents.includes(it.intent));assert(it.utterance?.trim());assert(it.seeds.length<=6);assert(Array.isArray(it.expected.must_convey));assert(Array.isArray(it.expected.must_not));assert(it.expected.evidence_basis?.length);
  if(kind!=='primary'){const p=a.items.find(x=>x.local_id===it.companion_of);assert(p);assert.deepEqual(it.seeds,p.seeds,worker+' companion context');}
  const id=`IQ9B-${worker}-${it.local_id}`,companion_of=it.companion_of?`IQ9B-${worker}-${it.companion_of}`:null;
  items.push({id,worker,surface,kind,intent:it.intent,seeds:it.seeds,utterance:it.utterance,companion_of});expectations.push({...it,id,worker,surface,kind,companion_of});
 }
 composition[worker]={primary:80,paraphrases:25,flips:25,multiturn:a.items.filter(i=>i.seeds.length>=2).length,intents:Object.fromEntries(intents.map(i=>[i,a.items.filter(x=>x.intent===i).length]))};
}
const previousPaths=['artifacts/intelligence-quality-v1-iq8f-corpus-runner.json','artifacts/intelligence-quality-v1-iq9a-dev-runner.json'];
const previous=new Set(previousPaths.flatMap(p=>JSON.parse(fs.readFileSync(p)).items.map(i=>norm(i.utterance))));
const overlap=items.filter(i=>i.kind==='primary'&&previous.has(norm(i.utterance))).map(i=>i.id);
assert(overlap.length/320<=.02,'Prior-corpus exact overlap exceeds frozen gate');
assert.equal(new Set(items.filter(i=>i.kind==='primary').map(i=>JSON.stringify([i.surface,i.seeds.map(norm),norm(i.utterance)]))).size,320,'Duplicate new primary scenario');
const write=(suffix,data)=>{const p=base+suffix+'.json';fs.writeFileSync(p,JSON.stringify(data,null,2)+'\n',{flag:'wx'});files.push(p);};
write('-corpus',{items});write('-expectations',{items:expectations});
const candidate='872fb7bf264d30865e1aadb5dfa44ae46a9579d6';
assert.equal(execFileSync('git',['diff',candidate,'--','src','supabase','migrations','package.json','package-lock.json','tsconfig.json'],{encoding:'utf8'}),'');
const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(d=>d.isDirectory()?walk(p+'/'+d.name):[p+'/'+d.name]);
const dist_manifest=walk('dist').sort().map(path=>({path,sha256:sha(fs.readFileSync(path))}));
fs.writeFileSync(base+'-seal.json',JSON.stringify({candidate,sealed_at:new Date().toISOString(),runtime_tree:execFileSync('git',['rev-parse',candidate+':src'],{encoding:'utf8'}).trim(),composition,primary:320,companions:200,scored:520,setup_turns:items.reduce((n,i)=>n+i.seeds.length,0),overlap:{normalization:'NFKC lower alphanumeric words',compared_files:previousPaths,primary_exact_overlap:overlap,rate:overlap.length/320},files:files.map(path=>({path,sha256:sha(fs.readFileSync(path))})),dist_manifest},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({composition,primary:320,companions:200,setup_turns:items.reduce((n,i)=>n+i.seeds.length,0),overlap}));
