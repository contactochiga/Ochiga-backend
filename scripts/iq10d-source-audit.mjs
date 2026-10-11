// Changed-diff hygiene only, not a substitute for a full security audit.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const base='993bc507673e6c7665e6e5332a3202e4daf57743';
const git=(...a)=>execFileSync('git',a,{encoding:'utf8',maxBuffer:80e6});
git('diff','--check',base);
const tracked=git('diff',base,'--name-only').trim().split('\n').filter(Boolean);
const untracked=git('ls-files','--others','--exclude-standard').trim().split('\n').filter(Boolean);
assert(untracked.every(p=>/^scripts\/iq10d-|^artifacts\/intelligence-quality-v1-iq10d-|^docs\/INTELLIGENCE_QUALITY_V1_IQ10D/.test(p)),'Unexpected untracked work; review ownership before committing');
assert(!tracked.some(p=>/^(?:supabase|migrations|\.env)/.test(p)),'Unexpected infrastructure change');
const patterns=[
 ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
 ['github-token',/\b(?:ghp_|github_pat_)[A-Za-z0-9_]{25,}/],
 ['provider-key',/\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}/],
 ['aws-key',/\bAKIA[0-9A-Z]{16}\b/],
 ['jwt',/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/],
 ['credential-url',/https?:\/\/[^\s/:]+:[^\s/@]+@/],
];
const added=git('diff',base,'--unified=0').split('\n').filter(l=>l.startsWith('+')&&!l.startsWith('+++')).join('\n');
const blobs=[['changed-diff',added],...untracked.map(p=>[p,fs.readFileSync(p,'utf8')])];
const findings=blobs.flatMap(([path,s])=>patterns.filter(([,r])=>r.test(s)).map(([rule])=>({path,rule})));
assert.equal(findings.length,0,JSON.stringify(findings));
const files=[...new Set([...tracked,...untracked])].map(path=>({path,bytes:fs.statSync(path).size}));
assert(files.every(f=>f.bytes<2_000_000),'Review large generated artifacts before committing');
console.log(JSON.stringify({diff_check:'PASS',changed_diff_secret_patterns:'PASS',files,limitations:'Pattern scan of changed lines/new files only; not a repository-wide security certification.'},null,2));
