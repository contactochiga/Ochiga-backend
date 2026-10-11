// New synthetic contract scenarios. No sealed certification corpus is loaded.
import assert from 'node:assert/strict';
import {parseSemanticFrame} from '../dist/oyi-core/interpretation/SemanticFrameParser.js';
import {isCancellationText} from '../dist/oyi-core/interpretation/semanticObjective.js';
import {hazardReportIn,hazardClassIn} from '../dist/oyi-core/response/answerTarget.js';
import {answerScopeDecision,evidenceScopeProvenance} from '../dist/oyi-core/response/scopeProvenance.js';
const results=[];
const check=(id,fn)=>{try{fn();results.push({id,status:'PASS'});}catch(e){results.push({id,status:'FAIL',error:e.message});}};
const ctx=(surface,message)=>({actor:{id:'synthetic-resident'},input:{surface,message},oisContext:{estate_id:'estate-synthetic',home_id:surface==='consumer'?'home-synthetic':null,home:surface==='consumer'?{id:'home-synthetic',name:'R-404'}:null}});
for(const q of ["Show Mira's wallet balance.",'And T-515?','Show repairs for the home named Willow.','Show the visitors for resident Mira.'])check(`scope-reference-${q}`,()=>assert.equal(answerScopeDecision(ctx('consumer',q),parseSemanticFrame(q,{surface:'consumer'})).decision,'denied'));
check('office-personal-wallet-not-portfolio',()=>{const q="What is Mira's wallet balance?";assert.equal(answerScopeDecision(ctx('office_internal',q),parseSemanticFrame(q,{surface:'office_internal'})).decision,'denied');});
check('canonical-actor-scoped-memory',()=>{const q='What did we discuss recently?',c=ctx('consumer',q);c.oisContext=null;c.actor={id:'synthetic-resident',role:'resident',estate_id:'estate-synthetic',home_id:'home-synthetic'};c.resolvedTurn={semantic_frame:parseSemanticFrame(q,{surface:'consumer'})};assert.equal(evidenceScopeProvenance(c,'context.memory.recall',[{authorised_scope:{estate_id:'estate-synthetic',home_id:'home-synthetic'}}]).decision,'compatible');});
for(const domain of ['wallet balance','maintenance repairs','visitors','devices','security incidents']){
 for(const surface of ['consumer','office_internal','public_corporate','facility'])check(`foreign-${surface}-${domain}`,()=>{const q=`Give me the ${domain} for apartment T-515.`;assert.equal(answerScopeDecision(ctx(surface,q),parseSemanticFrame(q,{surface})).decision,'denied');});
 check(`own-${domain}`,()=>{const q=`Show my ${domain}.`;assert.equal(answerScopeDecision(ctx('consumer',q),parseSemanticFrame(q,{surface:'consumer'})).decision,'compatible');});
}
for(const q of ['Summarize our Office financial position.','Show the portfolio balance.'])check(`office-positive-${q}`,()=>assert.equal(answerScopeDecision(ctx('office_internal',q),parseSemanticFrame(q,{surface:'office_internal'})).decision,'compatible'));
for(const q of ['Cancel the north-wing reading-lamp action that I requested earlier.','Abort the north-wing reading-lamp request.','Revoke that pending command.','Do not turn on the long north-wing balcony reading lamp.'])check(`withdrawal-${q}`,()=>assert(isCancellationText(q)));
for(const q of ['What happens if I cancel an action?','Please turn on the reading lamp.','I do not want to sell my land.','Do not promise that an email was delivered without evidence from the recipient system.','Do not imply that somebody will call unless a handoff actually succeeded.'])check(`non-withdrawal-${q}`,()=>assert(!isCancellationText(q)));
for(const [q,c] of [['The extractor motor is sparking.','electrical'],['Smoke is coming from the laundry socket.','fire'],['Someone is forcing the balcony window.','intrusion'],['Water is flooding the electrical cabinet.','water'],['The circulation pump is overheating.','electrical']])check(`hazard-${c}-${q}`,()=>{assert(hazardReportIn(q));assert.equal(hazardClassIn(q),c);});
check('retrieved-scope-mismatch-withheld',()=>{const q='Show my visitors.',c=ctx('consumer',q);c.resolvedTurn={semantic_frame:parseSemanticFrame(q,{surface:'consumer'})};const p=evidenceScopeProvenance(c,'visitors.access.read',[{authorised_scope:{estate_id:'estate-synthetic',home_id:'other-private-home'}}]);assert.equal(p.decision,'denied');assert.equal(p.presented,'withheld');assert.deepEqual(p.retrieved,[]);});
check('actual-source-provenance',()=>{const q='Show my devices.',c=ctx('consumer',q);c.resolvedTurn={semantic_frame:parseSemanticFrame(q,{surface:'consumer'})};const p=evidenceScopeProvenance(c,'devices.inventory.read',[{authorised_scope:{estate_id:'estate-synthetic',home_id:'home-synthetic'}}]);assert.equal(p.decision,'compatible');assert.equal(p.retrieved[0].home_id,'home-synthetic');});
console.log(JSON.stringify({results,pass:results.filter(r=>r.status==='PASS').length,fail:results.filter(r=>r.status==='FAIL').length},null,2));
process.exitCode=results.some(r=>r.status==='FAIL')?1:0;
