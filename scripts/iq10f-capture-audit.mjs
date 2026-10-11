// Read-only reconciliation of first-contact evidence. Never replay or backfill.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
assert.equal(process.env.SUPABASE_URL,'http://127.0.0.1:55421');
const require=createRequire(import.meta.url),{supabaseAdmin:db}=require('../dist/supabase/supabaseClient.js');
const gaps=[];
for(const w of ['OMA','OSA','FACILITY','CONSUMER']){
 const raw=fs.readFileSync('/tmp/iq10f-first-'+w+'.jsonl','utf8').trim().split('\n').map(JSON.parse);
 for(const r of raw.filter(r=>!r.trace?.trace_id||r.error||r.response?.persistence_saved!==true)){
  const id=r.response?.execution?.durable_trace?.trace_id;
  const trace=id?await db.from('oyi_conversation_traces').select('*').eq('trace_id',id):{data:[],error:null};
  const messages=await db.from('oyi_conversation_messages').select('id,role,metadata').eq('thread_id',r.thread_id).eq('metadata->>trace_request_id',r.response?.persistence_trace_request_id||r.request_id);
  gaps.push({worker:w,id:r.id,run_id:r.run_id,scored:r.scored,request_id:r.request_id,thread_id:r.thread_id,original_error:r.error,original_trace_receipt:r.response?.execution?.durable_trace??null,reconciled_trace:trace.data,trace_query_error:trace.error?.code??null,message_rows:messages.data,message_query_error:messages.error?.code??null,classification:r.error?.message==='conversation_access_denied'?'PRE_ADMISSION_OWNERSHIP_REJECTION':trace.data?.length?'LATE_DURABLE_TRACE':'UNRESOLVED_DURABLE_TRACE_LOSS'});
 }
}
fs.writeFileSync(process.env.WAVE11_HARNESS_OUT+'.json',JSON.stringify({audited_at:new Date().toISOString(),method:'Exact-ID read only; no replay, trace reconstruction or backfill',gaps},null,2),{flag:'wx'});
console.log(JSON.stringify(gaps.map(g=>({worker:g.worker,id:g.id,classification:g.classification,trace_rows:g.reconciled_trace?.length,message_rows:g.message_rows?.length})),null,2));
