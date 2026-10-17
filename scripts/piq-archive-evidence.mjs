// Lossless, exclusive evidence packaging; never executes or grades a turn.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const files=process.argv.slice(2);
assert(files.length>0);
const sha=b=>createHash('sha256').update(b).digest('hex');
const root='artifacts/piq-20261016-raw';
fs.mkdirSync(root,{recursive:true});
const checks=[/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/,/AIza[0-9A-Za-z_-]{30,}/,/sk-(?:proj-)?[A-Za-z0-9_-]{30,}/,/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/];
for(const file of files){
 assert(file.startsWith('/tmp/piq-')||file.startsWith('/tmp/iq11c-piq-'));
 const bytes=fs.readFileSync(file),text=bytes.toString('utf8');
 assert(!checks.some(r=>r.test(text)),'Potential credential pattern; contents withheld');
 const dest=path.join(root,path.basename(file)+'.gz');
 const compressed=gzipSync(bytes,{level:9});
 fs.writeFileSync(dest,compressed,{flag:'wx'});
 fs.writeFileSync(dest+'.metadata.json',JSON.stringify({source:file,artifact:dest,raw_bytes:bytes.length,compressed_bytes:compressed.length,raw_sha256:sha(bytes),compressed_sha256:sha(compressed),credential_pattern_scan:'no findings',lossless:true},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({artifact:dest,bytes:compressed.length,raw_sha256:sha(bytes)}));
}
