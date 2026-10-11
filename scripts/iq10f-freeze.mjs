import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const workers=['OMA','OSA','FACILITY','CONSUMER'];
const intents='LIST COUNT STATUS DETAIL VALUE_SUM YES_NO EXPLANATION COMPARISON_RANKING LIMITATION REFUSAL CONSTRAINT CLARIFICATION ACTION_CONFIRMATION SAFETY_RISK DISCOVERY FOLLOWUP_CONTEXT'.split(' ');
const dimensions='understanding context_memory evidence reasoning_judgment initiative communication action_judgment'.split(' ');
const hashes={},distribution={},authorship={},ids=new Set();
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
for(const w of workers){
 const path='artifacts/intelligence-quality-v1-iq10f-author-'+w+'.json',c=JSON.parse(fs.readFileSync(path));
 assert.equal(c.worker,w);assert.equal(c.journeys.length,10);assert.equal(c.companions.length,50);
 assert.equal(c.authorship.prohibited_inputs_accessed,false);authorship[w]=c.authorship;
 const primary=c.journeys.flatMap(j=>{assert.equal(j.turns.length,8);return j.turns;});assert.equal(primary.length,80);
 for(const kind of ['paraphrase','operation_flip']){const cc=c.companions.filter(x=>x.kind===kind);assert.equal(cc.length,25);assert.equal(new Set(cc.map(x=>x.parent_id)).size,25);}
 for(const x of [...primary,...c.companions]){
  assert(!ids.has(x.id),'Duplicate ID '+x.id);ids.add(x.id);assert(x.prompt?.trim());assert(intents.includes(x.intent),x.id+' intent');
  assert(x.dimensions?.length&&x.dimensions.every(d=>dimensions.includes(d)),x.id+' dimensions');
  assert(x.expected?.must_include?.length||x.expected?.must_not_claim?.length,x.id+' expectation');
  assert(x.expected.acceptable_outcomes?.length&&x.expected.rationale,x.id+' outcome');
  if(x.kind){assert(primary.some(p=>p.id===x.parent_id));if(x.kind==='paraphrase')assert.equal(x.intent,primary.find(p=>p.id===x.parent_id).intent);}
  else distribution[x.intent]=(distribution[x.intent]||0)+1;
 }
 hashes[path]=hash(path);
}
for(const i of intents)assert(distribution[i]>=12,i+' undersampled');
for(const p of ['docs/INTELLIGENCE_QUALITY_V1_IQ10F_PROTOCOL.md','docs/INTELLIGENCE_QUALITY_V1_IQ10F_AUTHOR_SPEC.md','scripts/iq10f-run.mjs','scripts/iq10f-freeze.mjs'])hashes[p]=hash(p);
const protocolHashes=JSON.parse(fs.readFileSync('artifacts/intelligence-quality-v1-iq10f-protocol-hashes.json'));
for(const [p,h]of Object.entries(protocolHashes))assert.equal(hash(p),h);
assert.equal(execFileSync('git',['diff','46efdbbae5ad3090c389cf9ddc799f15e00e68e3','--','src','supabase','package.json','package-lock.json'],{encoding:'utf8'}),'');
const out={runtime:'46efdbbae5ad3090c389cf9ddc799f15e00e68e3',protocol_commit:'c8c1b7f',frozen_at:new Date().toISOString(),primary:320,paraphrase:100,operation_flip:100,total:520,intents:distribution,authorship,hashes};
fs.writeFileSync('artifacts/intelligence-quality-v1-iq10f-corpus-manifest.json',JSON.stringify(out,null,2),{flag:'wx'});console.log(JSON.stringify({total:520,intents:distribution,hashes},null,2));
