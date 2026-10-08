import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
// Frozen IQ-7 held-out suite only; IQ-8F sealed corpus is never read.
const results=[];
for(const [file,configName] of [['iq7-eval-heldout','iq7-eval-config'],['iq7-e2e-heldout','iq7-e2e-config']]){
  const prefix=`${process.env.WAVE11_HARNESS_OUT}-${file}`;
  const cfg={suite:'artifacts/intelligence-quality-v1-iq7-heldout-suite-A.json',split:'all',out:`${prefix}.json`};
  let source=fs.readFileSync(`scripts/${file}.mjs`,'utf8');
  source=source.replace(`JSON.parse(fs.readFileSync('/tmp/${configName}.json', 'utf8'))`,JSON.stringify(cfg));
  source=source.replaceAll("'../dist/",`'${process.cwd()}/dist/`);
  const p=spawnSync(process.execPath,['--input-type=module','-e',source],{env:process.env,stdio:['ignore',fs.openSync(`${prefix}.stdout`,'wx'),fs.openSync(`${prefix}.stderr`,'wx')],timeout:120000});
  results.push({suite:file,exit:p.status,output:cfg.out});
}
fs.writeFileSync(`${process.env.WAVE11_HARNESS_OUT}.json`,JSON.stringify(results,null,2));
console.log(JSON.stringify(results));process.exitCode=results.some(r=>r.exit!==0)?1:0;
