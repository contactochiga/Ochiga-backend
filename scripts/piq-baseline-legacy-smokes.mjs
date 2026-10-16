// Compare unchanged legacy smokes with the starting reconciliation implementation
// loaded in memory. Never checkout/reset the worktree or alter compiled files.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
const base='1d10c992566169d48b30158df2cc681d27abf3eb';
const changed=execFileSync('git',['diff',base,'--name-only','--','src'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
assert.deepEqual(changed,['src/oyi-core/observability/conversationTraceReconciliation.ts']);
const suites=['conversation-foundation-smoke','oyi-core-convergence-smoke'];
const results=[];
for(const suite of suites){
 const code=`
 const fs=require('node:fs'),{execFileSync}=require('node:child_process'),ts=require('typescript'),Module=require('node:module');
 const fetchOriginal=globalThis.fetch;
 globalThis.fetch=(input,options)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!['127.0.0.1','localhost'].includes(u.hostname)||u.port!=='55421')throw Error('NONLOCAL_NETWORK_FORBIDDEN');return fetchOriginal(input,options);};
 const file=process.cwd()+'/dist/oyi-core/observability/conversationTraceReconciliation.js';
 const source=execFileSync('git',['show','${base}:src/oyi-core/observability/conversationTraceReconciliation.ts'],{encoding:'utf8'});
 const config=ts.readConfigFile('tsconfig.json',ts.sys.readFile).config;
 const options=ts.parseJsonConfigFileContent(config,ts.sys,process.cwd()).options;
 const mod=new Module(file);mod.filename=file;mod.paths=Module._nodeModulePaths(require('node:path').dirname(file));require.cache[file]=mod;
 mod._compile(ts.transpileModule(source,{compilerOptions:options}).outputText,file);
 import(require('node:url').pathToFileURL(process.cwd()+'/scripts/${suite}.mjs').href);
 `;
 const r=spawnSync(process.execPath,['-e',code],{env:process.env,encoding:'utf8',timeout:60000});
 // Legacy assertion errors embed source, not credentials. Keep only structural
 // summaries here; no raw error payload is needed for comparison.
 results.push({suite,baseline:base,exit:r.status,signal:r.signal,pass:(r.stdout.match(/^PASS\b/gm)||[]).length,
 failures:r.stderr.split('\n').filter(line=>line.startsWith('FAIL '))});
}
fs.writeFileSync(process.env.WAVE11_HARNESS_OUT+'.json',JSON.stringify({results},null,2),{flag:'wx'});
console.log(JSON.stringify({results},null,2));
process.exitCode=results.some(r=>r.exit!==0)?1:0;
