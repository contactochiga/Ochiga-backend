import assert from "node:assert/strict";

process.env.OYI_IR_REORDER_WINDOW_MS = "15";
process.env.OYI_IR_SEQUENCE_GAP_TIMEOUT_MS = "25";
process.env.OYI_IR_DISPATCH_SPACING_MS = "0";
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";

const { __testIrSequencedLane } = await import("../dist/controllers/deviceCommandController.js");

function envelope(sequence, action = `key-${sequence}`) {
  return __testIrSequencedLane.envelope({
    commandExecutionId: `exec-${sequence}-${Math.random().toString(36).slice(2)}`,
    canonicalDeviceId: "tv-device-1",
    providerConnectionId: "provider-1",
    infraredId: "hub-1",
    remoteId: "remote-1",
    command: { type: "tv_remote", key: action, command_key: action },
    clientSequence: sequence,
    clientTimestamp: new Date().toISOString(),
    idempotencyKey: `idem-${sequence}-${action}`,
    source: "smoke",
  });
}

async function runSequenced(arrivalSequences) {
  __testIrSequencedLane.reset();
  const dispatched = [];
  const promises = arrivalSequences.map((sequence) => __testIrSequencedLane.run("lane:provider-1:hub-1:remote-1", envelope(sequence), async () => {
    dispatched.push(sequence);
    return sequence;
  }));
  await Promise.all(promises);
  return dispatched;
}

async function runUnsequenced(labels) {
  __testIrSequencedLane.reset();
  const dispatched = [];
  const promises = labels.map((label) => {
    const env = envelope(null, label);
    return __testIrSequencedLane.run("lane:provider-1:hub-1:remote-1", env, async () => {
      dispatched.push(label);
      return label;
    });
  });
  await Promise.all(promises);
  return dispatched;
}

assert.deepEqual(await runSequenced([13, 12, 14]), [12, 13, 14], "out-of-order rapid taps dispatch in client sequence order");
assert.deepEqual(await runSequenced([12, 14]), [12, 14], "missing sequence gap releases without deadlock");
assert.deepEqual(await runUnsequenced(["a", "b", "c"]), ["a", "b", "c"], "unsequenced commands preserve FIFO arrival order");

console.log("ir-sequence-ordering-behavior-smoke passed");
setImmediate(() => process.exit(0));
