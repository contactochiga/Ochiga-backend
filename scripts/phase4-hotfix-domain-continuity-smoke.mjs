import assert from "node:assert/strict";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "phase4-hotfix-domain-continuity-smoke-service-role-key";

// Oyi Conversational Runtime Completion Programme, Phase 4 hotfix --
// domain-only conversation continuity. Found in live production
// verification: a keyword-less follow-up after a LIST/aggregate answer
// ("show me my overdue tasks" -> "move the first two to Monday") had no
// way to know it was still about office_tasks, because Phase 2's
// continuity mechanism only ever recognized a populated SINGLE-RECORD
// *_context slot. This proves the new domain-only path without touching
// the existing single-record behavior (unchanged, still requires a real
// slot -- see buildOfficeActiveContext's own untouched shape).
const {
  buildOfficeDomainOnlyActiveContext,
  buildOfficeActiveContext,
  usableOfficeActiveContext,
} = await import("../dist/oyi-core/context/officeConversationContext.js");

// --- buildOfficeDomainOnlyActiveContext: no slot, just a domain marker ---
const domainOnly = buildOfficeDomainOnlyActiveContext({
  threadId: "thread-1",
  actorId: "actor-1",
  domain: "office_tasks",
  capabilityKey: "office_tasks.query.read",
  intentLabel: "Tasks",
  userMessage: "Show me my overdue tasks",
  resultStatus: "observed",
  resultAnswer: "2 overdue tasks: ...",
});
assert.equal(domainOnly.active_domain, "office_tasks");
assert.equal(domainOnly.active_context_slot_key, null);
assert.equal(domainOnly.active_context_slot, null);
assert.equal(domainOnly.active_record_ref, null);

// --- usableOfficeActiveContext: domain-only memory is now usable (previously required slot_key+slot) ---
const usableDomainOnly = usableOfficeActiveContext(domainOnly, "actor-1");
assert.ok(usableDomainOnly, "a domain-only memory record must be usable");
assert.equal(usableDomainOnly.active_domain, "office_tasks");

// Wrong actor / expired / wrong surface still correctly rejected.
assert.equal(usableOfficeActiveContext(domainOnly, "someone-else"), null);
assert.equal(usableOfficeActiveContext({ ...domainOnly, expires_at: new Date(Date.now() - 1000).toISOString() }, "actor-1"), null);
assert.equal(usableOfficeActiveContext({ ...domainOnly, surface: "consumer" }, "actor-1"), null);
assert.equal(usableOfficeActiveContext(domainOnly, null), null);
assert.equal(usableOfficeActiveContext(null, "actor-1"), null);

// --- Existing single-record continuity is completely unaffected ---
const populated = {
  slotKey: "task_context",
  domain: "office_tasks",
  slot: { task_ref: "task-1", title: "Follow up with vendor", safe_summary: "x" },
  ref: "task-1",
  safeSummary: "x",
};
const singleRecord = buildOfficeActiveContext({
  threadId: "thread-1",
  actorId: "actor-1",
  populated,
  capabilityKey: "office_tasks.read",
  intentLabel: "Tasks",
  userMessage: "is this task overdue",
  resultStatus: "observed",
  resultAnswer: "It's overdue.",
});
assert.equal(singleRecord.active_context_slot_key, "task_context");
assert.deepEqual(singleRecord.active_context_slot, populated.slot);
const usableSingleRecord = usableOfficeActiveContext(singleRecord, "actor-1");
assert.ok(usableSingleRecord);
assert.equal(usableSingleRecord.active_context_slot_key, "task_context");

console.log("phase4-hotfix-domain-continuity-smoke: PASS");
