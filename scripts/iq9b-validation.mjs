// Read-only repository/evidence validation, plus a diagnostic artifact.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const base='artifacts/intelligence-quality-v1-iq9b',candidate='872fb7bf264d30865e1aadb5dfa44ae46a9579d6';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim(),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
assert.equal(git('branch','--show-current'),'codex/intelligence-quality-v1');
assert.equal(git('diff',candidate,'--','src','supabase','migrations','package.json','package-lock.json','tsconfig.json'),'');
git('diff','--check');
const files=[...new Set([...git('diff','--name-only',candidate).split('\n'),...git('ls-files','--others','--exclude-standard').split('\n')])].filter(Boolean);
assert(files.every(p=>/^(artifacts\/intelligence-quality-v1-iq9b-|docs\/INTELLIGENCE_QUALITY_V1_IQ9B_|scripts\/iq9b-)/.test(p)));
const patterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/gh[pousr]_[A-Za-z0-9]{30,}/,/sk-(?:proj-)?[A-Za-z0-9_-]{32,}/,/eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/];
const hits=[],sizes=[];
for(const path of files){const data=fs.readFileSync(path,'utf8'),bytes=fs.statSync(path).size;if(patterns.some(p=>p.test(data)))hits.push(path);sizes.push({path,bytes});assert(bytes<100*1024*1024,path+' exceeds GitHub file bound');}
assert.deepEqual(hits,[],'credential-shaped material detected; inspect without printing secrets');
const preservation=JSON.parse(fs.readFileSync(base+'-preservation.json'));
for(const f of preservation.frozen_files)assert.equal(sha(f.path),f.sha256);
const failures=preservation.canonical.filter(x=>x.status!=='PASS').map(x=>({suite:x.suite,exit:x.exit,stderr_sha256:sha(x.stderr),stderr:fs.readFileSync(x.stderr,'utf8'),stdout_sha256:sha(x.stdout)}));
for(const f of failures)assert(!patterns.some(p=>p.test(f.stderr)));
fs.writeFileSync(base+'-validation.json',JSON.stringify({candidate,artifact_head_at_validation:git('rev-parse','HEAD'),runtime_schema_dependency_diff_zero:true,changed_paths_only_iq9b:true,diff_check:'PASS',secret_pattern_scan:{status:'PASS',files:files.length,scope:'Private-key/GitHub/provider-token/JWT patterns; not a comprehensive security audit',hits},files:sizes,largest_files:[...sizes].sort((a,b)=>b.bytes-a.bytes).slice(0,5),frozen_historical_hashes:'UNCHANGED',historical_workflow_failures:failures,no_merge_or_deploy:true},null,2)+'\n');
console.log(JSON.stringify({files:files.length,diff:'PASS',secret_patterns:'PASS',runtime_diff:'ZERO',historical_failures:failures.length}));
