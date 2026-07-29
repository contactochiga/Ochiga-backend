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

check("raw payload requires provider numeric key id and category id", () => {
  assert.match(tuya, /rawCommandPayload\(version:\s*string,\s*keyBinding:\s*CanonicalIrKeyBinding,\s*binding:\s*CanonicalIrBinding\)/);
  assert.match(tuya, /!\/\^\[0-9\]\+\$\/\.test\(cleanStr\(keyId\)\)/);
  assert.match(tuya, /IR_RAW_KEY_METADATA_INCOMPLETE/);
});

check("raw payload is not manufactured from canonical text", () => {
  const rawPayloadBody = tuya.match(/private rawCommandPayload[\s\S]*?\n  }\n\n  async executeIrRemoteCommand/)?.[0] || "";
  assert.doesNotMatch(rawPayloadBody, /rawKey\)/);
  assert.doesNotMatch(rawPayloadBody, /rawKey,/);
  assert.doesNotMatch(rawPayloadBody, /key_id:[^\n]*(rawKey|key\))/);
  assert.match(rawPayloadBody, /providerRawKey\(def\)/);
});

check("raw fallback is limited to endpoint compatibility with verified metadata", () => {
  assert.match(tuya, /endpointIncompatible/);
  assert.match(tuya, /provider_code === "20001"/);
  assert.match(tuya, /canTryRawKey/);
  assert.match(tuya, /raw_fallback:\s*false/);
});

console.log("ir-strict-payload-smoke passed");
