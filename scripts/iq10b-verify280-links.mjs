import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
assert.equal(process.env.SUPABASE_URL,'http://127.0.0.1:55421');
const require=createRequire(import.meta.url);
const {supabaseAdmin:db}=require('../dist/supabase/supabaseClient.js');
const records=JSON.parse(fs.readFileSync(process.env.WAVE11_HARNESS_OUT.replace(/-links$/,'')+'280.json')).records;
assert.equal(records.length,280);
const threads=[...new Set(records.map(r=>r.thread_id))];
const q=await db.from('oyi_conversation_messages').select('id,thread_id,role,metadata').in('thread_id',threads).limit(1000);assert(!q.error);
const links=records.map(r=>{
 const rows=q.data.filter(m=>m.thread_id===r.thread_id&&m.metadata?.trace_request_id===r.request_id);
 return {journey_id:r.journey_id,turn:r.turn_number,message_count:rows.length,roles:rows.map(m=>m.role).sort(),
  trace_id:r.trace?.trace_id,receipt_matches:r.trace?.trace_id===r.response?.execution?.durable_trace?.trace_id};
});
assert(links.every(l=>l.message_count===2&&l.roles.join(',')==='assistant,user'&&l.receipt_matches));
fs.writeFileSync(process.env.WAVE11_HARNESS_OUT+'.json',JSON.stringify({persisted_turns:280,paired_messages:q.data.length,durably_correlated:280,links},null,2));
console.log('280 turns -> 560 exact message rows -> 280 durable trace IDs PASS');
