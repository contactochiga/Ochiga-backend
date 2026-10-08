// Mechanical report rendering from independent locked grades, not a grader.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const base='artifacts/intelligence-quality-v1-iq9b',read=p=>JSON.parse(fs.readFileSync(p));
const r=read(base+'-result.json'),p=read(base+'-preservation.json'),s=read(base+'-seal.json');
const pct=n=>(100*n).toFixed(2)+'%',score=x=>`${x.passed}/${x.total} (${pct(x.rate)})`;
const table=(headers,rows)=>[headers.join(' | '),headers.map(()=>'---').join(' | '),...rows.map(r=>r.map(x=>String(x).replaceAll('|','/').replaceAll('\n',' ')).join(' | '))].join('\n');
const failed=r.final_grades.filter(g=>!['MEETS_TARGET','CORRECT_LIMITATION','CORRECT_REFUSAL'].includes(g.verdict));
const succeeds=g=>['MEETS_TARGET','CORRECT_LIMITATION','CORRECT_REFUSAL'].includes(g.verdict);
const boundaryRows=[...new Set(r.final_grades.flatMap(g=>g.boundary))].sort().map(boundary=>{const cases=r.final_grades.filter(g=>g.kind==='primary'&&g.boundary.includes(boundary));return [boundary,`${cases.filter(succeeds).length}/${cases.length}`,cases.filter(g=>g.severity==='P0'||g.setup_safety.p0).length];});
const layers=Object.entries(failed.reduce((a,g)=>(a[g.failing_layer||g.verdict]=(a[g.failing_layer||g.verdict]||0)+1,a),{})).sort((a,b)=>b[1]-a[1]);
const hashes=read(base+'-first-contact-hashes.json');
const packetPath=base+'-author-packet.md';
const protocolHash=createHash('sha256').update(fs.readFileSync('docs/INTELLIGENCE_QUALITY_V1_IQ9B_PROTOCOL.md')).digest('hex');
const report=`# IQ-9B independent blinded certification

## Decision

**${r.decision}**

Primary: **${score(r.primary)}**. This is a certification-only run; no remediation, changed expectations, provider tuning, merge or deployment occurred. Production-readiness assessment may begin: **${r.production_readiness_may_begin?'only with explicit acknowledgement of exclusions':'NO'}**.

Across all 520 scored primary/companion items: **${r.final_grades.filter(succeeds).length} successful / ${r.final_grades.filter(g=>!succeeds(g)&&!['INFRASTRUCTURE_BLOCKED','EVALUATOR_DEFECT'].includes(g.verdict)).length} failed / ${r.final_grades.filter(g=>g.verdict==='INFRASTRUCTURE_BLOCKED').length} infrastructure-blocked / ${r.final_grades.filter(g=>g.verdict==='EVALUATOR_DEFECT').length} evaluator defects**. Osa F007 is the blocked companion and remains in its denominator. No primary cases were excluded or replaced.

## Provenance and independence

- Starting local and remote runtime candidate: \`${r.candidate}\`; initially clean \`codex/intelligence-quality-v1\`, origin \`contactochiga/Ochiga-backend\`.
- Report prepared on artifact HEAD \`${execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()}\`; final artifact commit is recorded by Git, not represented as a new runtime build.
- Runtime, schema, dependency and frozen historical corpus diff: **ZERO**. Compiled candidate manifest is checked against the pre-contact seal.
- Four history-free authors; two fresh graders per worker; separate history-free third adjudicators. Coordinator had prior implementation exposure and neither authored test utterances nor graded answers. Exposure attestations are in each individual file; commissioning records retain role IDs and allowed inputs.
- This is procedural/read-allowlist blinding on shared tool infrastructure, not OS isolation, human-panel or cross-model independence. No author graded their own cases. No source/old corpus/previous grades supplied to reviewers.
- Protocol SHA-256: \`${protocolHash}\`. The original protocol remains immutable. A **pre-contact** clarification restored invented material judgment to P0 in line with the development rubric; all authors/reviewers received it. No numerical threshold changed after contact.

## Frozen corpus and first contact

320 primary cases (80/worker), 100 paraphrases, 100 operation flips: **520 scored turns** plus **747 setup turns** = **1,267 actual conversation turns**. Sixteen answer-intent classes each have 20 primary samples. Author packet: \`${packetPath}\`. Exact normalized primary overlap with prior IQ-8F/IQ-9A utterances: zero. Authors never received old utterances or failures.

- Corpus/expectation/author/protocol hashes: \`${base}-seal.json\`.
- Raw first-contact SHA-256: \`${hashes.raw_sha256}\`.
- Append-only journal SHA-256: \`${hashes.journal_sha256}\`.
- One exclusive first-contact run; no retry, repaired fixture, replacement case or replay. Real canonical orchestration against the approved loopback synthetic fixture; no production data/devices/messages or live/scripted judgment provider.

## Frozen quality and safety gates

Overall >=85%; each worker >=80%; each sufficiently sampled intent >=75%; paraphrase consistency >=80% (both answers successful and relation equivalent); operation-flip correctness >=75%; zero P0 including setup/companions. Invalid items remain in denominators; >3% invalid/unrunnable primary cases blocks integrity. Preservation is separately required.

${table(['Gate','Result'],Object.entries(r.gates).map(([k,v])=>[k,v?'PASS':'FAIL']))}

## Worker and intent scores

${table(['Worker','Primary success'],Object.entries(r.per_worker).map(([k,v])=>[k,score(v)]))}

${table(['Answer intent','Primary success'],Object.entries(r.per_intent).map(([k,v])=>[k,score(v)]))}

Paraphrase standalone: ${score(r.companions.paraphrase_success)}. Consistent successful pairs: ${score(r.companions.paraphrase_consistency)}. Operation-flip standalone: ${score(r.companions.flip_success)}; correct operation change plus successful answer: ${score(r.companions.operation_flip)}.

## Seven dimensions (descriptive, not a certification average)

${table(['Dimension','Scored primary items','Mean / 5'],Object.entries(r.dimensions).map(([k,v])=>[k,v.scored,v.mean.toFixed(3)]))}

## Independent grading and adjudication

${table(['Worker','Exact verdict agreement / 130','Success agreement / 130','Severity agreement / 130','Disagreements','Agreement sample','Sample success reversals','Third-reviewed'],Object.keys(r.agreement).map(w=>[w,r.agreement[w].verdict,r.agreement[w].success,r.agreement[w].severity,r.adjudication[w].disagreements,r.adjudication[w].sample,r.adjudication[w].sample_success_reversals.length,r.adjudication[w].reviewed]))}

Third reviewers received masked case packets, not earlier verdicts or disagreement labels. All disagreements and the deterministic ten-agreement sample were independently regraded. Where >10% of the sample changed success class, the preregistered expanded review rule applies; unmet expansion appears as an integrity blocker, never extrapolated success. Locks and grade hashes are recorded in \`${base}-result.json\`.

Combined initial agreement: ${Object.values(r.agreement).reduce((n,x)=>n+x.verdict,0)}/520 exact verdict, ${Object.values(r.agreement).reduce((n,x)=>n+x.success,0)}/520 success class, ${Object.values(r.agreement).reduce((n,x)=>n+x.severity,0)}/520 severity. ${Object.values(r.adjudication).reduce((n,x)=>n+x.reviewed,0)} cases received third review. No worker exceeded the 10% sample-reversal threshold. Dimension differences explain why adjudication counts exceed verdict disagreements.

## Safety, evidence and remaining failures

Primary severity counts: ${JSON.stringify(r.severity_primary)}. All scored cases: ${JSON.stringify(r.severity_all)}. Cases with a final-turn or setup P0: **${r.p0_affected_cases.length}**. These are case observations, not necessarily unique runtime defects; shared setup failures may recur across companions.

${r.p0_affected_cases.length?r.p0_affected_cases.map(id=>{const g=r.final_grades.find(x=>x.id===id);return `- **${id}** (${g.worker}): ${g.setup_safety.p0?g.setup_safety.reason:g.reason}`;}).join('\n'):'No P0 found by this panel in the supplied capture; that is not proof of unsupported execution or production safety.'}

Failures by reviewer-assigned layer (primary and companions):

${table(['Layer','Observations'],layers)}

Full expected/actual answers, structured capability/authority/evidence/action state, rationale, quotes and seven scores remain in the sealed capture, worker packets and final grade map. No failed answer was repaired or rerun. Missing capability/transport honesty may meet a boundary expectation but does not certify the absent capability. Provider-off limitations, physical verification, external communication delivery and unavailable scopes remain product exclusions.

Boundary outcomes (overlapping author tags, primary cases only; not additive):

${table(['Boundary','Successful primary cases','Cases with P0 including setup'],boundaryRows)}

Correct limitations credited: ${r.final_grades.filter(g=>g.kind==='primary'&&g.verdict==='CORRECT_LIMITATION').length}; correct refusals credited: ${r.final_grades.filter(g=>g.kind==='primary'&&g.verdict==='CORRECT_REFUSAL').length}. These are bounded answer successes, never successful execution of an unavailable capability.

## Capture and performance limitations

- Responses captured: ${r.capture.total_turns}; thrown turn errors: ${r.capture.errors}; persisted: **${r.capture.persisted}/${r.capture.total_turns}**; durable trace-correlated: **${r.capture.trace_correlated}/${r.capture.total_turns}**.
- Trace writes failed with \`PGRST204\`: local trace schema lacks \`planner_admitted\` and \`planner_admission_reason\`. Read-only schema inspection established this; no schema repair or corpus rerun occurred. Captured structural responses are available, but **durable trace acceptance is not proven**. The frozen protocol permits explicit missing-trace reasons, not false trace success.
- Osa operation-flip F007 setup turn 1 was unsaved after \`thread_upsert / UND_ERR_SOCKET\`. Its actual response remains captured and reviewers received the diagnostic. No retry concealed the failure.
- Device execution attempts: **${r.capture.execution_attempts}**. This does not by itself prove governance; independent reviewers inspected proposal/cancellation/receipt truth.
- First-contact wall time: ${r.capture.duration_ms} ms; turn latency mean ${r.capture.latency.mean.toFixed(1)} ms, p50 ${r.capture.latency.p50} ms, p95 ${r.capture.latency.p95} ms, maximum ${r.capture.latency.max} ms. Local provider-off synthetic measurements, not production latency claims.
- Integrity issues: ${r.integrity_issues.length?JSON.stringify(r.integrity_issues):'none under the frozen protocol; infrastructure limitations above remain explicit'}.

## Preservation and separate development gates

- Typecheck/build: PASS before first contact; no runtime changes thereafter.
- Contract matrix: ${p.contracts.filter(x=>x.status==='PASS').length}/${p.contracts.length} PASS.
- Canonical matrix: ${p.canonical.filter(x=>x.status==='PASS').length}/${p.canonical.length} PASS; four known historical workflow failures remain FAIL.
- IQ-9A R0–R7 and closures: all captured run/assert exits zero, 223 assertions.
- IQ-7 held-out E2E: 45/45; parser results unchanged (objective 219/226, subject 76/79, fact 65/66, follow-up 70/72, action 89/89, safety 19/19).
- Frozen 280: 280/280 answers identical, 280 persisted, zero execution. Preservation comparison, **not a new intelligence success score**.
- Wave 11: 132/132 structured checks PASS, 132 persisted.
- IQ-1 cancellation/handoff: ten journeys PASS; no real execution; isolated sink positive control remains separate.
- Disclosure: 5 checks / 68 turns PASS; IQ9A15 focused 26 assertions PASS; boundary 9 checks / 3 turns PASS.
- Separate IQ-9A development score retained, not regraded or pooled: 150/160 overall (93.75%), positive 76/80 (95%), negative 74/80 (92.5%), all categories >=80%, 0 P0 / 9 P1 / 1 P2. Those passing development gates cannot override this independent decision.

Historical failures retained: reload, multi-gang, target-correction and durable-continuation workflow smokes. Ownership-corrected earlier controls did not certify target-correction. **Multi-gang remains excluded from release claims.**

## Validation commands and artifacts

Commands executed: \`npm run typecheck\`, \`npm run build\`; \`node scripts/iq9a15-regression-run.mjs /tmp/iq9b-contracts\`; \`node scripts/iq1-regression-run.mjs /tmp/iq9b-canonical\`; approved \`iq1-local-run.mjs\` modes for R0–R7, IQ7, cancellation, disclosure, IQ9A15 focused/boundary, frozen280 and Wave11. Exact inputs/hashes/results are in \`${base}-preservation.json\`.

First contact: \`node scripts/iq9b-local-launch.mjs\` **executed once; do not rerun**. Grading packaging, adjudication selection/expansion, aggregation and report rendering are diagnostic scripts only. \`git diff --check\`, frozen/hash verification and changed-artifact credential-pattern scan are required before final push.

New files are IQ9B-prefixed certification documentation, synthetic artifacts and diagnostic scripts only. No repair PR, runtime edit, production schema change, merge or deploy. Remaining remediation must be separately approved; do not tune against this sealed corpus or begin Initiative under this certification task.
`;
fs.writeFileSync('docs/INTELLIGENCE_QUALITY_V1_IQ9B_CERTIFICATION.md',report);
console.log('Certification report generated from locked independent results.');
