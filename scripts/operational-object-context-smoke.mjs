import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

const runtime = await import("../dist/oyi-core/context/conversationObjectHydration.js");

assert.equal(runtime.resolveContextSourceForTest({ explicit: true, thread: true, home: true, estate: true }), "explicit_request");
assert.equal(runtime.resolveContextSourceForTest({ explicit: false, thread: true, home: true, estate: true }), "thread_state");
assert.equal(runtime.resolveContextSourceForTest({ explicit: false, thread: false, home: true, estate: true }), "home_scope");
assert.equal(runtime.resolveContextSourceForTest({ explicit: false, thread: false, home: false, estate: true }), "estate_scope");
assert.equal(runtime.resolveContextSourceForTest({ explicit: false, thread: false, home: false, estate: false }), "global_scope");

console.log("operational object context smoke ok");
