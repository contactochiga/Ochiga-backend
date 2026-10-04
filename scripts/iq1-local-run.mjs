// Run existing certification corpora without editing frozen runners/artifacts.
// Secret retrieval is local CLI -> child environment only; never output or save it.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const [mode,output='/tmp/iq1-candidate',...rest]=process.argv.slice(2);
const root=process.cwd();
const frozen=['artifacts/intelligence-quality-v1-baseline.json','artifacts/intelligence-quality-v1-failure-map.json','artifacts/intelligence-quality-v1-root-causes.json','docs/INTELLIGENCE_QUALITY_V1_ROOT_CAUSE_ANALYSIS.md','scripts/intelligence-quality-v1-corpus.mjs','scripts/intelligence-quality-v1-review.mjs','scripts/intelligence-quality-v1-run.mjs','scripts/wave11-behavioural-torture-harness.mjs'];
for(const p of frozen)assert.equal(createHash('sha256').update(fs.readFileSync(p)).digest('hex'),createHash('sha256').update(execFileSync('git',['show',`45e89d299956fdd041f70f5937dbcc750a35aa6b:${p}`],{maxBuffer:30000000})).digest('hex'),`Frozen file changed: ${p}`);
assert(!fs.existsSync('.env'),'Worktree .env forbidden');
const c=JSON.parse(execFileSync('docker',['inspect','supabase_kong_wave11-behavioural-fixture'],{stdio:['ignore','pipe','pipe']}))[0];
assert(c.State.Running);
assert(c.NetworkSettings.Ports['8000/tcp'].some(p=>p.HostPort==='55421'));
let config;
try { config=JSON.parse(execFileSync('npx',['--no-install','supabase','status','--workdir','/tmp/oyi-wave11-supabase-fixture','-o','json'],{stdio:['ignore','pipe','pipe']})); }
catch { throw Error('Local fixture status unavailable; secret output withheld'); }
assert(config.SERVICE_ROLE_KEY,'Local fixture credential missing');
// Locator config omits API port; verify actual Docker port plus database identity.
const env={PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'test',REDIS_ENABLED:'false',SUPABASE_URL:'http://127.0.0.1:55421',OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY:config.SERVICE_ROLE_KEY,SUPABASE_SERVICE_ROLE_KEY:config.SERVICE_ROLE_KEY,WAVE11_FIXTURE_MODE:'live',WAVE11_HARNESS_OUT:output};
const probe=await fetch(`${env.SUPABASE_URL}/rest/v1/estates?select=id,name`,{headers:{apikey:config.SERVICE_ROLE_KEY,Authorization:`Bearer ${config.SERVICE_ROLE_KEY}`}});
assert(probe.ok,'Local fixture credential rejected');const estate=await probe.json();assert.equal(estate.length,1);assert.equal(estate[0].name,'Wave 11 Test Estate');
let args;
if(mode==='iq') {
  assert(!fs.existsSync(`${output}.json`),'Refusing to overwrite a run');
  let source=fs.readFileSync('scripts/intelligence-quality-v1-run.mjs','utf8');
  const guard='if (execFileSync(\'git\',[\'diff\',startingHead,\'--\',\'src\',\'supabase\',\'migrations\'],{encoding:\'utf8\'}).trim()) throw new Error(\'Baseline refuses modified runtime/schema\');';
  assert(source.includes(guard));
  source=source.replace(guard,'// IQ-1 candidate: runtime changes permitted; frozen inputs hash-verified by launcher.');
  source=source.replace("const output='artifacts/intelligence-quality-v1-baseline.json';",`const output=${JSON.stringify(`${output}.json`)};`);
  // Eval module retains exactly the same run loop/fixtures/prompts. Only module
  // locations, baseline-only guard and output destination differ.
  source=source.replace("const root = new URL('../', import.meta.url);",`const root = new URL(${JSON.stringify(pathToFileURL(root+'/').href)});`);
  source=source.replaceAll("'../dist/",`'${pathToFileURL(root+'/dist/').href}`);
  source=source.replace("'./intelligence-quality-v1-corpus.mjs'",JSON.stringify(pathToFileURL(root+'/scripts/intelligence-quality-v1-corpus.mjs').href));
  args=['--input-type=module','-e',source];
} else if(mode==='wave11') args=['scripts/wave11-behavioural-torture-harness.mjs'];
else if(mode==='adversarial') args=['scripts/iq1-cancellation-live-smoke.mjs',output];
else if(mode==='script') { assert(/^scripts\/[a-z0-9-]+\.mjs$/.test(rest[0]||''));args=[rest[0]]; }
else throw Error('Expected iq, wave11, adversarial or script');
const result=spawnSync(process.execPath,args,{env,stdio:['ignore',fs.openSync(`${output}.stdout`,'wx'),fs.openSync(`${output}.stderr`,'wx')],timeout:300000});
console.log(JSON.stringify({mode,exit:result.status,signal:result.signal,output,fixture:'verified loopback 55421',error:result.error?.code||null}));
process.exit(result.status??1);
