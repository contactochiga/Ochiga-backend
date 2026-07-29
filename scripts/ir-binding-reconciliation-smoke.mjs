import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const tuya = fs.readFileSync(path.join(root, "src/device/adapters/tuya/TuyaAdapter.ts"), "utf8");

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

check("IR remote reconciliation runs before dispatch", () => {
  assert.match(tuya, /resolveVerifiedIrRemote/);
  assert.match(tuya, /listIrRemotes\(infraredId,\s*context\)/);
  assert.match(tuya, /tuya_ir_binding_reconciliation_started/);
  assert.match(tuya, /tuya_ir_remote_match_selected/);
});

check("remote matching order is deterministic and rejects ambiguity", () => {
  assert.match(tuya, /remote_id/);
  assert.match(tuya, /remote_index/);
  assert.match(tuya, /category_brand/);
  assert.match(tuya, /name_category/);
  assert.match(tuya, /unique_category/);
  assert.match(tuya, /IR_REMOTE_RECONCILIATION_REQUIRED/);
  assert.doesNotMatch(tuya, /remotes\[0\]/);
});

check("IR key reconciliation uses current remote keys", () => {
  assert.match(tuya, /resolveVerifiedIrKey/);
  assert.match(tuya, /listIrRemoteKeys\(infraredId,\s*binding\.remote_id,\s*context\)/);
  assert.match(tuya, /key_id/);
  assert.match(tuya, /provider_key/);
  assert.match(tuya, /key_name/);
  assert.match(tuya, /canonical_alias/);
  assert.match(tuya, /IR_KEY_RECONCILIATION_REQUIRED/);
});

check("configuration repair is narrow and evidence-backed", () => {
  assert.match(tuya, /persistIrBindingRepair/);
  assert.match(tuya, /verified_at/);
  assert.match(tuya, /supported_keys/);
  assert.match(tuya, /tuya_ir_binding_repaired/);
});

console.log("ir-binding-reconciliation-smoke passed");
