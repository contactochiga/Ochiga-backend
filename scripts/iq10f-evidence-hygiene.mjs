// Certification-artifact checks only. No runtime or sealed-corpus replay.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
const runtime='46efdbbae5ad3090c389cf9ddc799f15e00e68e3';
const hash=b=>createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(fs.readFileSync('artifacts/intelligence-quality-v1-iq10f-corpus-manifest.json'));
for(const[p,h]of Object.entries(manifest.hashes))assert.equal(hash(fs.readFileSync(p)),h,p);
for(const x of Object.values(JSON.parse(fs.readFileSync('artifacts/intelligence-quality-v1-iq10f-first-contact-hashes.json')))){
 const b=fs.readFileSync(x.artifact);assert.equal(hash(b),x.gzip_sha256);assert.equal(hash(gunzipSync(b)),x.raw_sha256);
}
const existing=new Set(execFileSync('git',['ls-tree','-r','--name-only',runtime],{encoding:'utf8'}).trim().split('\n'));
const changed=execFileSync('git',['diff','--name-only',runtime],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
assert(changed.every(p=>!existing.has(p)),'Existing runtime/test/artifact modified');
execFileSync('git',['diff','--check']);
const files=[...new Set([...changed,...execFileSync('git',['ls-files','--others','--exclude-standard'],{encoding:'utf8'}).trim().split('\n').filter(Boolean)])];
const relevant=files.filter(p=>/iq10f|IQ10F/.test(p));
const patterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/gh[pousr]_[A-Za-z0-9]{30,}/,/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,/postgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@/,/sk-(?:proj-)?[A-Za-z0-9_-]{35,}/];
const result=[];
for(const p of relevant){const b=fs.readFileSync(p),data=p.endsWith('.gz')?gunzipSync(b):b;assert(patterns.every(re=>!re.test(data.toString())),`Secret pattern detected: ${p}`);result.push({path:p,bytes:b.length,sha256:hash(b)});}
assert(files.every(p=>/iq10f|IQ10F/.test(p)),'Unrelated change present');
console.log(JSON.stringify({runtime,runtime_and_existing_files_unchanged:true,corpus_and_raw_hashes_valid:true,diff_check:'PASS',changed_artifact_secret_patterns:'PASS',files:result},null,2));
