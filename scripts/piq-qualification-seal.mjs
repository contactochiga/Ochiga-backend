// Offline evidence preparation. No database or provider calls; no runtime mutation.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const sha=b=>createHash('sha256').update(b).digest('hex');
const root='artifacts/piq-20261016',workers=['oma','osa','facility','consumer'];
const mode=process.argv[2];
const dimensions=['understanding','context_memory','evidence','judgment','initiative_advice','communication','action_judgment'];
if(mode==='prepare-snapshot'){
 const source=fs.readFileSync('scripts/wave11-behavioural-torture-harness.mjs','utf8');
 const {officeSnapshot}=new Function(`${source.slice(source.indexOf('const ids = '),source.indexOf('function expected(prompt)'))};return {officeSnapshot};`)();
 fs.writeFileSync(root+'-office-snapshot.json',JSON.stringify(officeSnapshot(),null,2),{flag:'wx'});
 console.log('Office synthetic snapshot prepared for fixture review');
}else if(mode==='validate'||mode==='seal'){
 const counts={},ids=new Set();
 for(const worker of workers){
  const corpus=JSON.parse(fs.readFileSync(root+'-'+worker+'-corpus.json'));
  assert.equal(corpus.worker,worker);assert.equal(corpus.journeys.length,80);
  const turns=corpus.journeys.flatMap(j=>{assert(j.turns.length>=2);return j.turns;});
  const turnIds=new Set(turns.map(t=>t.id));
  assert.equal(corpus.companions.filter(c=>c.kind==='paraphrase').length,25);
  assert.equal(corpus.companions.filter(c=>c.kind==='operation_flip').length,25);
  for(const c of corpus.companions)assert(turnIds.has(c.parent_turn_id));
  for(const t of [...turns,...corpus.companions]){
   assert(!ids.has(t.id),'Duplicate ID '+t.id);ids.add(t.id);
   assert(typeof t.utterance==='string'&&t.utterance.length>0&&t.utterance.length<3000,t.id);
   assert(['default','denied',...(['facility','consumer'].includes(worker)?['visitor_denied']:[]),...(worker==='consumer'?['resident_b']:[])].includes(t.actor),t.id+' actor');
   assert(dimensions.includes(t.dimension),t.id+' dimension');
   assert(typeof t.safety==='boolean'&&['none','resolvable','ambiguous'].includes(t.ambiguity),t.id);
   assert(t.intent&&t.expected&&['answer','refusal','clarification','limitation','proposal','cancelled'].includes(t.expected.outcome),t.id);
   for(const k of ['subject','objective','operation','answer_target'])assert(t.expected[k],t.id+' '+k);
   assert(Array.isArray(t.expected.must)&&t.expected.must.length&&Array.isArray(t.expected.must_not),t.id);
   assert('reference' in t.expected,t.id);
  }
  for(const d of dimensions)assert(turns.some(t=>t.dimension===d),worker+' missing '+d);
  counts[worker]={journeys:corpus.journeys.length,primary_turns:turns.length,paraphrases:25,flips:25,setup_turns:corpus.companions.reduce((n,c)=>n+corpus.journeys.find(j=>j.turns.some(t=>t.id===c.parent_turn_id)).turns.findIndex(t=>t.id===c.parent_turn_id),0)};
 }
 console.log(JSON.stringify(counts));
 if(mode==='seal'){
  assert(!fs.existsSync(root+'-seal.json'),'Never reseal after first contact');
  assert.equal(execFileSync('git',['rev-parse','HEAD:src'],{encoding:'utf8'}).trim(),'d2c4a5e92bebd458f4fb1a0005c0b9c080d70240');
  assert(!execFileSync('git',['diff','--','src','migrations','supabase','package.json','package-lock.json'],{encoding:'utf8'}).trim());
  const manifest=JSON.parse(fs.readFileSync('/tmp/iq11c-piq-qualification-preflight-02-manifest.json'));
  const preflight=JSON.parse(fs.readFileSync('/tmp/iq11c-piq-qualification-preflight-02.json'));
  assert(preflight.preflight.ready&&preflight.pass===32&&preflight.fail===0);
  assert(manifest.files.every(f=>sha(fs.readFileSync(f.path))===f.sha256),'Preflight runtime changed');
  const p={source_sha256:sha(fs.readFileSync('/tmp/iq11c-piq-qualification-preflight-02.json')),manifest_sha256:preflight.manifest_sha256,fixture_hash:preflight.fixture_hash,preflight:preflight.preflight,checks:preflight.checks,pass:preflight.pass,fail:preflight.fail,executed:preflight.executed,attempts:preflight.captures.length};
  fs.writeFileSync(root+'-preflight.json',JSON.stringify(p,null,2),{flag:'wx'});
  assert(fs.existsSync(root+'-office-snapshot.json'),'Prepare and review Office snapshot first');
  const paths=[...manifest.files.map(f=>f.path),...workers.flatMap(w=>[root+'-'+w+'-corpus.json',root+'-'+w+'-authorship.md']),root+'-preflight.json',root+'-office-snapshot.json',
   'docs/OYI_PROVIDER_INDEPENDENT_QUALIFICATION_BASELINE.md','docs/OYI_PROVIDER_INDEPENDENT_QUALIFICATION_PROTOCOL.md','docs/OYI_PIQ_AUTHOR_SPEC.md','docs/OYI_PIQ_EXECUTION_ADDENDUM.md','docs/OYI_PIQ_GRADING_PROTOCOL.md',
   'scripts/piq-qualification-run.mjs','scripts/piq-qualification-seal.mjs','scripts/piq-runner-contract-tests.mjs','scripts/piq-evaluation-evidence.mjs','scripts/piq-qualification-score.mjs','scripts/piq-fixture-freeze.mjs','scripts/piq-authority-freeze.mjs',root+'-fixture-facts.json',root+'-authority.json',root+'-preexecution-review.json'];
  const seal={runtime_head:'bd97cc9c21c0bd1b4073e6a955b774a7a8af12b9',source_tree:'d2c4a5e92bebd458f4fb1a0005c0b9c080d70240',sealed_at:new Date().toISOString(),fixture_hash:preflight.fixture_hash,counts,files:[...new Set(paths)].sort().map(path=>({path,sha256:sha(fs.readFileSync(path))}))};
  fs.writeFileSync(root+'-seal.json',JSON.stringify(seal,null,2),{flag:'wx'});console.log('seal_sha256='+sha(fs.readFileSync(root+'-seal.json')));
 }
}else throw Error('Expected prepare-snapshot, validate or seal');
