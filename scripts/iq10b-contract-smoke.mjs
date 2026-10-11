import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
// Preserve and execute all original projection/privacy assertions. Its final
// static section encodes a pre-multipart function layout, already absent at
// the starting commit. Verify the same invariant at the actual new boundary.
const original=fs.readFileSync('scripts/intelligence-trace-projection-contract-smoke.mjs','utf8');
const boundary='// --- 10. single writer, single boundary ---';assert(original.includes(boundary));
const source=original.slice(0,original.indexOf(boundary)).replaceAll('"../dist/',`"${process.cwd()}/dist/`);
const p=spawnSync(process.execPath,['--input-type=module','-e',source],{env:process.env,stdio:'inherit'});assert.equal(p.status,0);
const start=execFileSync('git',['show','9dd062e8fea069afb40e5c99c0946318c16fd71b:src/oyi-core/orchestration/ConversationOrchestrator.ts'],{encoding:'utf8'});
const oldShape=/response = await this\.runTurn\(context, traceHolder\);\s*\} catch \(error\) \{\s*finalize\(null, error\);\s*throw error;\s*\}\s*finalize\(response, null\);\s*return response;/;
assert(!oldShape.test(start),'Documented legacy static failure must predate IQ10B');
const runtime=fs.readFileSync('src/oyi-core/orchestration/ConversationOrchestrator.ts','utf8').split('\n').map(l=>l.replace(/\/\/.*$/,'')).join('\n');
assert.equal([...runtime.matchAll(/recordConversationTrace\(/g)].length,1);
const wrapper=runtime.slice(runtime.indexOf('  async run(context:'),runtime.indexOf('  private async runObserved'));
assert.match(wrapper,/finally\s*\{[\s\S]*recordConversationTrace/);
assert.match(wrapper,/catch \(error\) \{ failure = error; throw error;/);
assert.match(wrapper,/durable_trace: receipt/);
const recorder=fs.readFileSync('src/oyi-core/observability/conversationTraceRecorder.ts','utf8');
assert.match(recorder,/export function recordConversationTrace/);assert.doesNotMatch(recorder,/export async function recordConversationTrace/);
assert.match(recorder,/ignoreDuplicates: true/);assert.match(recorder,/receipt.status = "failed"/);
const schema=fs.readFileSync('src/oyi-core/observability/conversationTraceSchema.ts','utf8');
assert.match(schema,/Object.keys\(TRACE_FIELD_CLASSIFICATION\)/);
const migration=fs.readFileSync('supabase/migrations/20261011072042_iq10b_trace_persistence_reliability.sql','utf8');
assert.match(migration,/add column if not exists planner_admitted boolean/);assert.match(migration,/add column if not exists planner_admission_reason text/);
assert.doesNotMatch(migration,/security definer|drop table|drop column/i);
console.log('IQ10B contract: original projection/privacy cases + current finally boundary, retry identity, additive schema and invoker privileges PASS');
