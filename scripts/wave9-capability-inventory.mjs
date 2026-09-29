import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
process.env.SUPABASE_URL="http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY="inventory-local-no-network";
const queueModule=require.resolve("bullmq");
require.cache[queueModule]={id:queueModule,filename:queueModule,loaded:true,exports:{Queue:class{add(){throw Error("inventory must not queue")}},Worker:class{}}};
const {supabaseAdmin}=require("../dist/supabase/supabaseClient.js");
supabaseAdmin.from=()=>{throw Error("inventory must not read DB")};
supabaseAdmin.rpc=()=>{throw Error("inventory must not call RPC")};
const {ensureRegistered}=require("../dist/oyi-core/orchestration/ConversationOrchestrator.js");
const {capabilityRegistry}=require("../dist/oyi-core/capabilities/CapabilityRegistry.js");
ensureRegistered();
const inventory=capabilityRegistry.all().map(c=>({
  id:c.key,reasoning_owner:"oyi_core",domain:c.domain,rollout:c.rolloutStatus,
  surfaces:c.supported_surfaces||[],permissions:c.permission_requirements||[],scope:c.scope_requirements||[],
  risk:c.risk_class||null,approval:c.confirmation_policy||null,evidence:c.evidence_requirements||[],
  handlers:{read:!!c.buildReadResponse,draft:!!c.createDraft,authorize:!!c.authorize,execute:!!c.execute,verify:!!c.verify},
  failure_authority:"CapabilityService + DomainResult + FallbackFirewall",
})).sort((a,b)=>a.id.localeCompare(b.id));
assert.equal(new Set(inventory.map(c=>c.id)).size,inventory.length);
for(const c of inventory.filter(c=>c.rollout==="enabled")){
  assert.ok(c.risk,`${c.id}: missing risk`);
  assert.ok(c.approval,`${c.id}: missing approval policy`);
  assert.ok(c.surfaces.length,`${c.id}: missing surfaces`);
}
if(process.argv.includes("--json"))console.log(JSON.stringify(inventory,null,2));
else console.log(`PASS canonical executable capability inventory: ${inventory.length} unique entries; enabled risk/approval/surface metadata present; no DB/provider calls`);
process.exit(0);
