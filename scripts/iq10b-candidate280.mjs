// Same frozen corpus, fixtures and run loop. Add fail-closed preflight, never
// alter expectations or the historical runner on disk.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
let source=fs.readFileSync('scripts/intelligence-quality-v1-run.mjs','utf8');
const guard="if (execFileSync('git',['diff',startingHead,'--','src','supabase','migrations'],{encoding:'utf8'}).trim()) throw new Error('Baseline refuses modified runtime/schema');";
assert(source.includes(guard));source=source.replace(guard,'// IQ10B runtime candidate; unchanged corpus is hash-verified by launcher.');
source=source.replace("const output='artifacts/intelligence-quality-v1-baseline.json';",`const output=${JSON.stringify(process.env.WAVE11_HARNESS_OUT+'.json')};`);
source=source.replace("const root = new URL('../', import.meta.url);",`const root = new URL(${JSON.stringify(pathToFileURL(process.cwd()+'/').href)});`);
source=source.replaceAll("'../dist/",`'${pathToFileURL(process.cwd()+'/dist/').href}`);
source=source.replace("'./intelligence-quality-v1-corpus.mjs'",JSON.stringify(pathToFileURL(process.cwd()+'/scripts/intelligence-quality-v1-corpus.mjs').href));
const probe="const traceProbe=await supabaseAdmin.from('oyi_conversation_traces').select('trace_id').limit(1);";
assert(source.includes(probe));
source=source.replace(probe,`const {preflightConversationTrace}=await import(${JSON.stringify(pathToFileURL(process.cwd()+'/dist/oyi-core/observability/conversationTraceSchema.js').href)});\nconst preflight=await preflightConversationTrace();if(preflight.status!=='compatible')throw Error('Trace preflight failed: '+preflight.status);\n${probe}`);
const p=spawnSync(process.execPath,['--input-type=module','-e',source],{env:process.env,stdio:'inherit',timeout:240000});
process.exitCode=p.status??1;
