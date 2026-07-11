import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

const runtime = await import("../dist/oyi-core/runtime/canonicalConversationRuntime.js");

assert.equal(runtime.canonicalTruthStateForTest({ status: "pending_confirmation" }), "pending_confirmation");
assert.equal(runtime.canonicalTruthStateForTest({ status: "denied" }), "permission_restricted");
assert.equal(runtime.canonicalTruthStateForTest({ status: "validation_required" }), "unsupported");
assert.equal(runtime.canonicalTruthStateForTest({ status: "executed" }), "confirmed");
assert.equal(runtime.canonicalTruthStateForTest({ hasAwareness: true, severity: "warning" }), "observed");
assert.equal(runtime.canonicalTruthStateForTest({ hasSources: true }), "observed");
assert.equal(runtime.canonicalTruthStateForTest({}), "inferred");

console.log("canonical truth smoke ok");
