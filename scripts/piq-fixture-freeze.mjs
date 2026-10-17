// Read-only, allowlisted synthetic evidence export. No inference/Core turn.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
assert.equal(process.env.SUPABASE_URL,'http://127.0.0.1:55421');
const tables={
 homes:'id,name,estate_id,resident_id,building_id',rooms:'id,name,home_id',
 devices:'id,name,estate_id,home_id,room_id,status,online,capabilities,last_seen_at',
 wallets:'id,home_id,balance,currency',wallet_transactions:'id,wallet_id,direction,type,amount,status,created_at',
 maintenance_requests:'id,title,status,priority,home_id,accepted_at,completed_at,verified_at',
 visitor_access:'id,home_id,visitor_name,purpose,status,expires_at',
 facility_cameras:'id,home_id,name,status,health_status,stream_status'
};
const records={};
for(const [table,fields]of Object.entries(tables)){
 const r=await fetch(process.env.SUPABASE_URL+'/rest/v1/'+table+'?select='+fields+'&order=id&limit=100',{headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY},signal:AbortSignal.timeout(5000)});
 assert(r.ok,'Local fixture export unavailable');const data=await r.json();assert(Array.isArray(data)&&data.length<100);records[table]=data;
}
const sha=createHash('sha256').update(JSON.stringify(records)).digest('hex');
fs.writeFileSync('artifacts/piq-20261016-fixture-facts.json',JSON.stringify({captured_at:new Date().toISOString(),tables,records,sha256:sha},null,2),{flag:'wx'});
console.log(JSON.stringify({status:'synthetic_fixture_frozen',sha256:sha,tables:Object.keys(tables)}));
