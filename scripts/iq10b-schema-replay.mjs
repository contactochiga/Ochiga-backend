// Local-only migration replay, privilege inspection and real missing-column
// preflight. Serialized with other fixture tests; restored in finally.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
assert.equal(process.env.SUPABASE_URL,'http://127.0.0.1:55421');
const require=createRequire(import.meta.url);
process.env.OYI_TRACE_REFERENCE_KEY='iq10b-local-only-canary-reference-not-a-credential';
const {preflightConversationTrace}=require('../dist/oyi-core/observability/conversationTraceSchema.js');
const sql=text=>execFileSync('docker',['exec','-i','supabase_db_wave11-behavioural-fixture','psql','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-At'],{input:text,encoding:'utf8'});
const migration=fs.readFileSync('supabase/migrations/20261011072042_iq10b_trace_persistence_reliability.sql','utf8');
const output=process.env.WAVE11_HARNESS_OUT;
const before=sql("select md5(coalesce(string_agg(row_to_json(t)::text,'' order by trace_id),'')) from public.oyi_conversation_traces t;").trim();
sql(migration);sql(migration);
const after=sql("select md5(coalesce(string_agg(row_to_json(t)::text,'' order by trace_id),'')) from public.oyi_conversation_traces t;").trim();
assert.equal(before,after,'Migration preserves existing traces');
const privilege=sql("select r,has_function_privilege(r,'public.oyi_persist_canonical_turn(jsonb,jsonb,jsonb,text)','EXECUTE'),has_function_privilege(r,'public.oyi_collapse_canonical_exchange(uuid,text[],text,text,boolean)','EXECUTE'),has_table_privilege(r,'public.oyi_conversation_traces','SELECT') from unnest(array['anon','authenticated','service_role']) r;").trim();
assert(privilege.includes('anon|f|f|f'));assert(privilege.includes('authenticated|f|f|f'));assert(privilege.includes('service_role|t|t|t'));
let missing;
try {
 sql("alter table public.oyi_conversation_traces rename column planner_admission_reason to iq10b_hidden_admission_reason; notify pgrst,'reload schema';");
 for(let i=0;i<10;i++){missing=await preflightConversationTrace();if(missing.status==='missing_migration')break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(missing.status,'missing_migration');
} finally {sql("alter table public.oyi_conversation_traces rename column iq10b_hidden_admission_reason to planner_admission_reason; notify pgrst,'reload schema';");}
let restored;for(let i=0;i<10;i++){restored=await preflightConversationTrace();if(restored.status==='compatible')break;await new Promise(r=>setTimeout(r,100));}
assert.equal(restored.status,'compatible');
fs.writeFileSync(output+'.json',JSON.stringify({migration_replayed_twice:true,existing_records_preserved:true,privilege,missing,restored},null,2));
console.log('Migration replay, least privilege, real schema drift detection and reconnection PASS');
