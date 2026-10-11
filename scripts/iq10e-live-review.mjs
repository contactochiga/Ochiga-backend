// Separate answer/context review; coarse transport assertions are not quality certification.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const prefix=process.argv[2];if(!prefix?.startsWith('/tmp/iq10e-'))throw Error('Local evaluation prefix required');
const run=JSON.parse(fs.readFileSync(prefix+'-dev.json')),checks=[];
const turn=(id,n)=>run.journeys.find(j=>j.id===id).turns[n-1],answer=(id,n)=>turn(id,n).response.answer;
function check(id,fn){try{fn();checks.push({id,status:'PASS'});}catch(e){checks.push({id,status:'FAIL',severity:'P1',error:e.message});}}
check('public-title-keeps-two-entities',()=>assert.equal(turn('E-OSA',5).metadata.public_opportunity_objective.entities.length,2));
check('public-title-retains-selected-property',()=>{const p=turn('E-OSA',5).metadata.public_opportunity_objective;assert.equal(p.known_facts.location,'Makurdi');assert.match(p.known_facts.title_document_status||'',/not.*verif|unverified/i);});
check('public-next-step-not-restart',()=>{assert.doesNotMatch(answer('E-OSA',6),/very little so far|anything specific you'd like/i);assert.match(answer('E-OSA',6),/title|document|terms|expectation/i);});
check('arrival-question-uses-visitors-not-devices',()=>{assert.match(answer('E-CONSUMER',5),/permission|visitor|arrival/i);assert.doesNotMatch(answer('E-CONSUMER',5),/latest readings for 4 devices/);});
check('office-missing-answer-specific',()=>assert.match(answer('E-OMA',5),/^The missing requirement|^What I cannot confirm/));
check('facility-verification-not-summary',()=>assert.match(answer('E-FACILITY',5),/^Verify|^Check|^Clarify/));
const out={review:'separate maintainer answer review, not independently authored grading',checks,pass:checks.filter(x=>x.status==='PASS').length,fail:checks.filter(x=>x.status==='FAIL').length};fs.writeFileSync(prefix+'-live-review.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));process.exitCode=out.fail?1:0;
