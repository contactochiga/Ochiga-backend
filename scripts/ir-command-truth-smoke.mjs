import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const tuya = fs.readFileSync(path.join(root, "src/device/adapters/tuya/TuyaAdapter.ts"), "utf8");
const store = fs.readFileSync(path.join(root, "src/services/deviceCommandExecutionStore.ts"), "utf8");

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

check("provider false is rejected immediately and not physical success", () => {
  assert.match(tuya, /method === "POST" && !tuyaResultAccepted\(response\)/);
  assert.match(tuya, /IR_PROVIDER_REJECTED/);
  assert.match(tuya, /physical_effect_status:\s*"unknown"/);
  assert.match(tuya, /confirmation_strategy:\s*"provider_ack_only"/);
});

check("standard command logs selected endpoint and accepted/rejected truth", () => {
  assert.match(tuya, /tuya_ir_standard_dispatch_started/);
  assert.match(tuya, /tuya_ir_standard_dispatch_accepted/);
  assert.match(tuya, /tuya_ir_standard_dispatch_rejected/);
  assert.match(tuya, /ir_provider_response_received/);
});

check("classified IR errors survive command execution status", () => {
  assert.match(store, /ir_remote_reconciliation_required/);
  assert.match(store, /ir_key_reconciliation_required/);
  assert.match(store, /ir_raw_key_metadata_incomplete/);
  assert.match(store, /ir_endpoint_incompatible/);
  assert.match(store, /ir_provider_rejected/);
});

console.log("ir-command-truth-smoke passed");
