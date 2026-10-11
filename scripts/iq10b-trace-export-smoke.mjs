import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
const path='scripts/intelligence-trace-live-smoke.mjs';
let source=fs.readFileSync(path,'utf8');
const old='assert.equal(d.stage_coverage.length, 12);';
assert(source.includes(old));
// IQ9A added planner_admission before IQ10B. Preserve every behavioral/privacy
// assertion, but use the actual canonical stage inventory rather than stale 12.
assert(execFileSync('git',['show','9dd062e8fea069afb40e5c99c0946318c16fd71b:src/oyi-core/observability/conversationTraceProjection.ts'],{encoding:'utf8'}).includes('"planner_admission"'));
source=source.replace(old,'assert.equal(d.stage_coverage.length, projection.OBSERVED_TRACE_STAGES.length);');
source=source.replaceAll('"../dist/',`"${process.cwd()}/dist/`);
const p=spawnSync(process.execPath,['--input-type=module','-e',source],{env:process.env,stdio:'inherit',timeout:200000});process.exitCode=p.status??1;
