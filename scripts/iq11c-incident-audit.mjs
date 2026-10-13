// Read-only structural audit of the unmodified, unexpected local regression failure.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const output=process.argv[2];assert(output?.startsWith('/tmp/iq11c-'));assert(!fs.existsSync(output));
const query=`SELECT json_build_object(
 'message_count',(SELECT count(*) FROM public.oyi_conversation_messages WHERE thread_id='c60f996d-3c7f-4687-b3e2-53734e07aa9f' AND metadata->>'trace_request_id'='92dca611-b96e-45bb-8aec-93880b5cb158'),
 'trace_count',(SELECT count(*) FROM public.oyi_conversation_traces WHERE trace_id='2d4ab155-e0db-4dfe-a1ac-928c71406157'));`;
const counts=JSON.parse(execFileSync('docker',['exec','supabase_db_wave11-behavioural-fixture','psql','-U','postgres','-d','postgres','-At','-c',query],{encoding:'utf8'}));
const result={audited_at:new Date().toISOString(),synthetic_only:true,read_only:true,replayed:false,
 request_id:'92dca611-b96e-45bb-8aec-93880b5cb158',thread_id:'c60f996d-3c7f-4687-b3e2-53734e07aa9f',trace_id:'2d4ab155-e0db-4dfe-a1ac-928c71406157',
 receipt:{delivery_state:'uncertain',failure_class:'unknown',attempts:2,stage:'insert'},...counts,
 classification:counts.message_count===0&&counts.trace_count===0?'MISSING_EXPECTED_SAVE_AND_TRACE':'REQUIRES_STRUCTURAL_RECONCILIATION',
 cause:'Unknown. Safe receipts and retained local database/PostgREST logs do not establish database rejection, transport failure or timeout.',
 certification_batch_ready:false};
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
