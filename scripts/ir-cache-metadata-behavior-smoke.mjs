import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";

const { TuyaAdapter } = await import("../dist/device/adapters/tuya/TuyaAdapter.js");

const remote = {
  remote_id: "remote-tv-1",
  remote_index: "7",
  category_id: 1,
  category_name: "TV",
  brand_id: 22,
  brand_name: "Brand",
  remote_name: "Living TV",
};

const keys = [
  { key_id: 49, key: "Right", key_name: "Right", category_id: 1, raw_key: "RAW_RIGHT" },
  { key_id: 106, key: "Mute", key_name: "Mute", category_id: 1, raw_key: "RAW_MUTE" },
];

function context() {
  return {
    userId: "resident-1",
    homeId: "home-1",
    device: {
      id: "",
      provider_connection_id: "provider-1",
      home_id: "home-1",
      metadata: {
        ir_appliance: {
          infrared_id: "hub-1",
          remote_id: "remote-tv-1",
          remote_index: "7",
          category_id: 1,
          category_name: "TV",
          brand_id: 22,
          brand_name: "Brand",
          remote_name: "Living TV",
          appliance_type: "television",
          supported_keys: keys.map((key) => ({ ...key, canonical_action: String(key.key).toLowerCase() })),
        },
      },
    },
    canonicalDevice: { id: "tv-device-1" },
  };
}

function fakeClient({ falseOnCommand = false } = {}) {
  const calls = { remotes: 0, keys: 0, command: 0, raw: 0 };
  return {
    calls,
    async request(method, path, body) {
      if (method === "GET" && /\/remotes$/.test(path)) {
        calls.remotes += 1;
        return { result: [remote] };
      }
      if (method === "GET" && /\/keys$/.test(path)) {
        calls.keys += 1;
        return { result: keys };
      }
      if (method === "POST" && /\/raw\/command$/.test(path)) {
        calls.raw += 1;
        assert.notEqual(body?.key_id, "Right", "raw key_id must never be canonical text");
        return { success: true, result: true };
      }
      if (method === "POST" && /\/command$/.test(path)) {
        calls.command += 1;
        return falseOnCommand ? { success: true, result: false } : { success: true, result: true };
      }
      throw new Error(`unexpected fake Tuya request ${method} ${path}`);
    },
  };
}

const clientA = fakeClient();
const adapterA = new TuyaAdapter(clientA);
await adapterA.executeIrRemoteCommand("hub-1", "remote-tv-1", { type: "tv_remote", key: "Right", command_key: "right" }, context());
await adapterA.executeIrRemoteCommand("hub-1", "remote-tv-1", { type: "tv_remote", key: "Right", command_key: "right" }, context());
assert.equal(clientA.calls.remotes, 1, "repeated cached key does not re-fetch bound remotes");
assert.equal(clientA.calls.keys, 1, "repeated cached key does not re-fetch key catalogue");
assert.equal(clientA.calls.command, 2, "both commands dispatch");

await adapterA.executeIrRemoteCommand("hub-1", "remote-tv-1", { type: "tv_remote", key: "Mute", command_key: "mute" }, context());
assert.equal(clientA.calls.remotes, 1, "different key reuses cached remote binding");
assert.equal(clientA.calls.keys, 2, "different key resolves its own key binding");

const diff = adapterA.diffIrBindingMetadata(context().device.metadata, {
  infrared_id: "hub-1",
  remote_id: "remote-tv-1",
  remote_index: "7",
  category_id: 1,
  category_name: "TV",
  brand_id: 22,
  brand_name: "Brand",
  remote_name: "Living TV",
  appliance_type: "television",
  provider_version: null,
  verified_at: new Date().toISOString(),
  match_strategy: "remote_id",
}, {
  canonical_action: "right",
  provider_key: "Right",
  provider_key_id: 49,
  raw_key: "RAW_RIGHT",
  key_name: "Right",
  category_id: 1,
  remote_id: "remote-tv-1",
  verified_at: new Date().toISOString(),
  match_strategy: "key_id",
  definition: keys[0],
});
assert.equal(diff.changed, false, "matching metadata validates without write");

const repaired = adapterA.diffIrBindingMetadata(context().device.metadata, {
  infrared_id: "hub-1",
  remote_id: "remote-tv-2",
  remote_index: "7",
  category_id: 1,
  category_name: "TV",
  brand_id: 22,
  brand_name: "Brand",
  remote_name: "Living TV",
  appliance_type: "television",
  provider_version: null,
  verified_at: new Date().toISOString(),
  match_strategy: "remote_index",
}, null);
assert.equal(repaired.changed, true, "changed remote identity is detected");
assert.ok(repaired.changed_fields.includes("remote_id"), "changed fields include remote_id");

const clientB = fakeClient({ falseOnCommand: true });
const adapterB = new TuyaAdapter(clientB);
await assert.rejects(
  adapterB.executeIrRemoteCommand("hub-1", "remote-tv-1", { type: "tv_remote", key: "Right", command_key: "right" }, context()),
  /IR controller rejected|rejected this key/i,
  "provider false becomes command failure",
);

console.log("ir-cache-metadata-behavior-smoke passed");
setImmediate(() => process.exit(0));
