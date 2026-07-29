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

check("IR endpoint compatibility cache is scoped by connection hub remote and endpoint", () => {
  assert.match(tuya, /irCompatibilityScope\(context\?: AdapterContext, infraredId\?: string, remoteId\?: string, endpointKind\?: string\)/);
  assert.match(tuya, /\$\{region\}:\$\{scope\}:\$\{hub \|\| "unknown-hub"\}:\$\{remote \|\| "hub"\}:\$\{endpoint\}/);
});

check("request options pass remote id and endpoint kind into compatibility", () => {
  assert.match(tuya, /loadIrCompatibility\(options\?\.context, options\?\.infraredId, options\?\.remoteId, options\?\.endpointKind\)/);
  assert.match(tuya, /rememberIrCompatibility\(options\.context, options\.infraredId, options\.remoteId, options\.endpointKind/);
  assert.match(tuya, /endpointKind:\s*"remote_keys"/);
  assert.match(tuya, /endpointKind:\s*"remote_command"/);
  assert.match(tuya, /endpointKind:\s*"raw_remote_command"/);
});

check("explicit provider/key/binding errors do not version-fallback through requestIr", () => {
  assert.match(tuya, /explicitIrCode/);
  assert.match(tuya, /IR_PROVIDER_REJECTED/);
  assert.match(tuya, /throw error;/);
});

console.log("ir-endpoint-compatibility-smoke passed");
