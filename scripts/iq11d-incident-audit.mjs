// Exact-ID read-only local audit. Never replay or backfill failed requests.
import fs from 'node:fs';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
const output=process.argv[2];assert(output?.startsWith('/tmp/iq11d-'));
const journal=fs.readFileSync('/tmp/iq11c-iq11d-candidate-attempts.jsonl','utf8').trim().split('\n').map(JSON.parse);
const rows=journal.filter(x=>x.event==='returned');
const uuid=/^[0-9a-f-]{36}$/;assert(rows.every(x=>uuid.test(x.request_id)&&uuid.test(x.trace_id)));
const values=rows.map(x=>`('${x.request_id}','${x.trace_id}')`).join(',');
const sql=`WITH attempts(request_id,trace_id) AS (VALUES ${values}) SELECT json_agg(json_build_object('request_id',a.request_id,'trace_id',a.trace_id,'message_count',(SELECT count(*) FROM public.oyi_conversation_messages m WHERE m.metadata->>'trace_request_id'=a.request_id),'trace_count',(SELECT count(*) FROM public.oyi_conversation_traces t WHERE t.trace_id::text=a.trace_id))) FROM attempts a;`;
const counts=JSON.parse(execFileSync('docker',['exec','supabase_db_wave11-behavioural-fixture','psql','-U','postgres','-d','postgres','-At','-c',sql],{encoding:'utf8'}));
const result={synthetic_only:true,read_only:true,replayed:false,audited_at:new Date().toISOString(),started:journal.filter(x=>x.event==='started').length,returned:rows.length,counts,incident:counts.find(x=>x.request_id==='d3460940-59d2-42b5-aca9-54fd3508bc70'),cause:'Immediate bounded lookup returned lookup_unavailable; underlying timeout/transport cause is not established. This later durable lookup does not rewrite the failed preflight.',development_turns_attempted:0,certification_ready:false};
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
