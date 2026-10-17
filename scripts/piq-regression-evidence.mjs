// Archive unchanged regression outputs, retaining failed assertions and hashes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
const patterns=[/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/,/\b(?:ghp_|github_pat_)[A-Za-z0-9_]{25,}/,/\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}/,/AIza[A-Za-z0-9_-]{30,}/,/\bAKIA[0-9A-Z]{16}\b/,/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,/https?:\/\/[^\s/:]+:[^\s/@]+@/];
assert(fs.readFileSync('scripts/intelligence-trace-live-smoke.mjs','utf8').includes('sk-SENTINEL${TAG}secretTOKEN0123456789'));
const files=fs.readdirSync('/tmp').filter(n=>n.startsWith('piq-regression-targeted')||n.startsWith('piq-regression-chain')).filter(n=>fs.statSync('/tmp/'+n).isFile()).sort().map(name=>{
 const bytes=fs.readFileSync('/tmp/'+name),raw=bytes.toString('utf8');
 const markers=raw.match(/sk-SENTINEL[A-Za-z0-9]+secretTOKEN0123456789/g)||[];
 const content=raw.replace(/sk-SENTINEL[A-Za-z0-9]+secretTOKEN0123456789/g,'[REDACTED_SYNTHETIC_SECRET_SENTINEL]');
 assert(!patterns.some(p=>p.test(content)),'Potential credential in '+name+'; contents withheld');
 return {name,raw_sha256:sha(bytes),archived_sha256:sha(content),synthetic_sentinel_redactions:markers.length,content};
});
const artifact='artifacts/piq-20261016-regression-evidence.json.gz';
const bytes=Buffer.from(JSON.stringify({synthetic_only:true,files}));
fs.writeFileSync(artifact,gzipSync(bytes,{level:9}),{flag:'wx'});
const read=p=>JSON.parse(fs.readFileSync('/tmp/'+p+'.json'));
const targeted=read('piq-regression-targeted'),chain=read('piq-regression-chain');
const summarize=a=>({suites:a.length,pass:a.filter(r=>r.status==='PASS').length,fail:a.filter(r=>r.status!=='PASS').length,results:a});
const out={targeted:summarize(targeted),chain:summarize(chain),failure_classification:{'intelligence-trace-projection-contract-smoke':'Static run-body regex still requires the old direct runTurn/catch/finalize shape. Existing multipart/correlation wrapper differs; canonical dynamic trace preflight and all first-contact exact-ID reconciliation pass. Assertion retained as FAIL, no runtime or expectation edit.', 'conversation-foundation-smoke':'Static source assertion requires pre-atomic per-message verification sequence. Existing canonical persistence uses oyi_persist_canonical_turn RPC. Assertion retained as FAIL; no expectation edit.',historical_workflow:'Five existing workflow suites remain FAIL: reload, multigang, correction, durable continuation and owned aggregate. Release exclusions remain.'},wave11:{total:read('piq-wave11').records.length,counts:read('piq-wave11').records.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{})},iq7_parser:read('piq-regression-chain-iq9a14-iq7-regression-iq7-eval-heldout').summary,iq7_e2e:read('piq-regression-chain-iq9a14-iq7-regression-iq7-e2e-heldout').summary,archive:{artifact,sha256:sha(fs.readFileSync(artifact)),uncompressed_sha256:sha(bytes),files:files.length,synthetic_sentinel_redactions:files.reduce((n,f)=>n+f.synthetic_sentinel_redactions,0),credential_scan:'no findings after documented synthetic-sentinel redaction'}};
fs.writeFileSync('artifacts/piq-20261016-regression-summary.json',JSON.stringify(out,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({targeted:{pass:out.targeted.pass,fail:out.targeted.fail},chain:{pass:out.chain.pass,fail:out.chain.fail},wave11:out.wave11,archive:out.archive}));
