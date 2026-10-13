// Offline delivery guard. Does not import/run the application, replay any corpus,
// access a database or modify existing evidence. --write only writes this slice's
// new verification receipt; all other modes are read-only.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const start='fcb6df6b08b11e81b324eea5e33a844cde104115';
const runtime='46efdbbae5ad3090c389cf9ddc799f15e00e68e3';
const prefix='artifacts/intelligence-quality-v1-iq11a-';
const receipt=prefix+'verification.json';
const files=[
 'docs/INTELLIGENCE_QUALITY_V1_IQ11A_ROOT_CAUSE_INVESTIGATION.md',
 'scripts/iq11a-inspect.mjs','scripts/iq11a-diagnosis.mjs',
 'scripts/iq11a-forensics.mjs','scripts/iq11a-verify.mjs',
 prefix+'primary-failure-map.json',prefix+'trace-reconciliation.json',
 prefix+'p0-forensics.json',receipt,
];
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
assert.equal(git('branch','--show-current'),'codex/intelligence-quality-v1');
assert.equal(git('remote','get-url','origin'),'git@github.com:contactochiga/Ochiga-backend.git');
for(const line of git('diff','--name-status',start).split('\n').filter(Boolean)){
 const [status,path]=line.split('\t');assert.equal(status,'A','Existing file changed: '+path);assert(files.includes(path),path);
}
for(const path of git('ls-files','--others','--exclude-standard').split('\n').filter(Boolean))assert(files.includes(path),path);
assert.equal(git('diff',runtime,'--','src','supabase','package.json','package-lock.json'),'');
execFileSync('git',['diff','--check',start],{stdio:'pipe'});
for(const s of files.filter(p=>p.endsWith('.mjs')))execFileSync(process.execPath,['--check',s],{stdio:'pipe'});
for(const s of ['scripts/iq11a-diagnosis.mjs','scripts/iq11a-forensics.mjs'])execFileSync(process.execPath,[s,'--verify'],{stdio:'pipe'});
const map=JSON.parse(fs.readFileSync(prefix+'primary-failure-map.json'));
assert.equal(new Set(map.records.map(r=>r.worker+':'+r.id)).size,256);
assert.equal(Object.values(map.primary_counts).reduce((a,b)=>a+b,0),256);
for(const row of map.records)assert(fs.existsSync(row.source_owner),row.source_owner);
const trace=JSON.parse(fs.readFileSync(prefix+'trace-reconciliation.json'));
assert.equal(trace.records.length,1285);
const p0=JSON.parse(fs.readFileSync(prefix+'p0-forensics.json'));
assert.equal(p0.occurrences.length,6);
const doc=fs.readFileSync(files[0],'utf8');
for(const match of doc.matchAll(/\]\((\.\.\/[^)]+)\)/g))assert(fs.existsSync('docs/'+match[1]),match[1]);
// Pattern scan, not a guarantee that every possible secret format is recognized.
// Only filenames/counts are reported; matching values are never printed.
const patterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
 /\bAKIA[0-9A-Z]{16}\b/,/\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
 /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/,
 /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{20,}\b/,
 /(?:postgres(?:ql)?):\/\/[^\s:@]+:[^\s@]+@/];
const hashes={},sizes={};
for(const path of files.filter(p=>p!==receipt)){
 const b=fs.readFileSync(path),text=b.toString();
 assert(!patterns.some(p=>p.test(text)),'Potential secret pattern in '+path);
 assert(b.length<5_000_000,'Unexpected artifact size: '+path);
 hashes[path]=createHash('sha256').update(b).digest('hex');sizes[path]=b.length;
}
const result={starting_head:start,runtime_head:runtime,method:'Offline analysis verification only; no runtime tests, database access or certification replay.',
 checks:{analysis_only_file_scope:true,existing_tracked_files_unchanged:true,runtime_diff_zero:true,
 syntax:true,artifact_reproduction:true,frozen_protocol_corpus_raw_hashes:true,
 primary_unique_rows:256,trace_request_rows:1285,p0_occurrences:6,source_owner_paths:true,
 report_artifact_links:true,diff_whitespace:true,changed_file_secret_patterns:0},
 limitations:['Pattern-based secret scan is not exhaustive.','Remote HEAD equality is verified separately after push.','No new runtime regression result is claimed.'],sizes_bytes:sizes,sha256:hashes};
const serialized=JSON.stringify(result,null,2)+'\n';
if(process.argv.includes('--write'))fs.writeFileSync(receipt,serialized);
else assert.equal(fs.readFileSync(receipt,'utf8'),serialized);
console.log(JSON.stringify(result.checks,null,2));
