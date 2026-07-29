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

check("IR commands use discovered key definitions before provider dispatch", () => {
  assert.match(tuya, /findSupportedIrKey/);
  assert.match(tuya, /supportedKeys\.length && !supportedDefinition/);
  assert.match(tuya, /tuya_ir_key_definition_selected/);
  assert.match(tuya, /provider_key_id/);
});

check("unsupported IR key fails before provider dispatch", () => {
  assert.match(tuya, /IR_KEY_NOT_SUPPORTED/);
  assert.match(tuya, /This TV remote key is not configured/);
});

check("provider false is classified as rejected, not dispatched success", () => {
  assert.match(tuya, /method === "POST" && !tuyaResultAccepted\(response\)/);
  assert.match(tuya, /IR_PROVIDER_REJECTED/);
  assert.match(tuya, /ir_provider_rejected/);
});

check("missing remote binding has a safe recovery message", () => {
  assert.match(tuya, /IR_REMOTE_BINDING_MISSING/);
  assert.match(tuya, /This TV remote is not configured/);
});

check("IR classifications survive command execution persistence", () => {
  assert.match(store, /ir_remote_binding_missing/);
  assert.match(store, /ir_key_not_supported/);
  assert.match(store, /ir_provider_rejected/);
  assert.match(store, /error\?\.safe_error_message/);
});

console.log("ir-configuration-contract-smoke passed");
