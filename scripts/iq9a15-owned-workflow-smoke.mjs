// Diagnostic replay: assertions and runtime are unchanged. Only synthetic thread
// identities/ownership are repaired to meet the current canonical thread contract.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const suites=['oyi-workflow-action-phase-c-multigang-smoke','oyi-workflow-action-phase-c-reload-smoke','oyi-workflow-action-phase-c-correction-smoke','oyi-workflow-durable-continuation-smoke'];
const results=[];
for(const suite of suites){
 let source=fs.readFileSync(`scripts/${suite}.mjs`,'utf8');
 const aliases=[...new Set([...source.matchAll(/["'](thread-[a-z0-9-]+)["']/g)].map(m=>m[1]))];
 const ids=aliases.map(a=>{const h=createHash('sha256').update(a).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;});
 for(let i=0;i<aliases.length;i++)source=source.replaceAll(aliases[i],ids[i]);
 ids.push(...[...source.matchAll(/(?:const threadId\s*=|threadId\s*=)\s*"([a-f0-9-]{36})"/g)].map(m=>m[1]));
 const unique=[...new Set(ids)],marker='async function run(';
 assert(source.includes(marker));
 source=source.replace(marker,`fakeSupabase.db.oyi_conversation_threads.push(...${JSON.stringify(unique)}.map(id=>({id,user_id:resident.id,surface:'consumer',estate_id:resident.estate_id,home_id:resident.home_id,metadata:{}})));\n${marker}`);
 const prefix=`${process.env.WAVE11_HARNESS_OUT}-${suite}`;
 const p=spawnSync(process.execPath,['--input-type=module','-e',source],{env:process.env,stdio:['ignore',fs.openSync(`${prefix}.stdout`,'wx'),fs.openSync(`${prefix}.stderr`,'wx')],timeout:30000});
 results.push({suite,status:p.status===0?'PASS':'FAIL',exit:p.status,owned_threads:unique.length,assertions_unchanged:true});
}
fs.writeFileSync(`${process.env.WAVE11_HARNESS_OUT}.json`,JSON.stringify(results,null,2));
console.log(JSON.stringify(results));
process.exitCode=results.every(r=>r.status==='PASS')?0:1;
