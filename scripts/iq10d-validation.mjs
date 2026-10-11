// Sequential local-only validation. No frozen artifact is rewritten.
import fs from 'node:fs';
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const prefix=process.argv[2];if(!prefix?.startsWith('/tmp/iq10d-'))throw Error('Use a fresh IQ10D temporary prefix');
const hash=()=>createHash('sha256').update(execFileSync('git',['diff','993bc507673e6c7665e6e5332a3202e4daf57743','--','src'])).digest('hex');
const before=hash(),results=[];
const run=(id,cmd,args,extra={})=>{
 const start=Date.now();const out=prefix+'-'+id;
 const p=spawnSync(cmd,args,{env:{...process.env,...extra},stdio:['ignore',fs.openSync(out+'.log','wx'),fs.openSync(out+'.error','wx')],timeout:360000});
 results.push({id,exit:p.status,signal:p.signal,duration_ms:Date.now()-start,log:out+'.log',error:out+'.error'});
 fs.writeFileSync(prefix+'-validation.json',JSON.stringify({source_diff_sha256:before,source_unchanged:before===hash(),results},null,2));console.log(JSON.stringify(results.at(-1)));
};
run('typecheck','npm',['run','typecheck']);run('build','npm',['run','build']);
for(const [id,script] of [['pure','iq10d-evidence-contracts'],['additional','iq10d-additional-contracts'],['trace-contract','iq10b-contract-smoke'],['context-pure','iq10c-context-contracts']])run(id,process.execPath,['scripts/'+script+'.mjs'],{WAVE11_HARNESS_OUT:prefix+'-'+id});
for(const [id,script] of [['dev','iq10d-evidence-live'],['context-live','iq10c-context-live'],['reliability','iq10b-reliability-live'],['export','iq10b-trace-export-smoke'],['candidate280','iq10b-candidate280'],['candidate-links','iq10b-verify280-links'],['reg','iq10a-regressions']])run(id,process.execPath,['scripts/iq1-local-run.mjs','script',prefix+'-'+id,'scripts/'+script+'.mjs']);
run('wave',process.execPath,['scripts/iq1-local-run.mjs','wave11',prefix+'-wave']);
if(hash()!==before)throw Error('Runtime changed during validation');
process.exitCode=results.some(r=>r.exit!==0&&r.id!=='reg')?1:0;
