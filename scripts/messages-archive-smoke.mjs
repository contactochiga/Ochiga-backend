#!/usr/bin/env node
// OYI Facility -- Final Messages + Buildings/Home Registry consolidation
// pass. Static regression proof for the two Backend changes: the new
// self-service thread-archive endpoint (activating dm_threads.is_archived,
// which has existed since the original messaging migration but was never
// wired to a route), and listInbox now excluding archived threads.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const controller = fs.readFileSync(path.join(root, "src/controllers/messagesController.ts"), "utf8");
const routes = fs.readFileSync(path.join(root, "src/routes/messages.ts"), "utf8");

const required = [
  ["archive route requires auth + tenant scope + community.write, same as other write routes", 'router.post("/thread/:threadId/archive", requireAuth, resolveRequestContext, requirePermission("community.write")'],
  ["archive route is audited like every other message mutation", 'auditOnSuccess("message.thread_archived", "thread", "threadId")'],
  ["setThreadArchived enforces the same tenant/scope check every other thread route uses", "await assertThreadInActiveScope(req, user, thread)"],
  ["setThreadArchived is member-only (self-service), not a moderation-only action", "await getMember(threadId, user.id)"],
  ["listInbox now excludes archived threads", '.eq("is_archived", false)'],
];
const combined = [controller, routes].join("\n");
const missing = required.filter(([, needle]) => !combined.includes(needle));
if (missing.length) {
  console.error("Messages archive smoke failed. Missing invariants:");
  for (const [label, needle] of missing) console.error(`- ${label}: ${needle}`);
  process.exit(1);
}

// Pre-existing invariants this pass must not have disturbed: every other
// route's permission/scope checks stay exactly as they were.
const preserved = [
  ["inbox still requires community.read + scope", 'router.get("/inbox", requireAuth, resolveRequestContext, requirePermission("community.read")'],
  ["send still requires community.write + audit", 'router.post("/thread/:threadId/messages", requireAuth, resolveRequestContext, requirePermission("community.write")'],
  ["moderation reports stay restricted to support.assign", 'router.get("/mod/reports", requireAuth, requirePermission("support.assign")'],
  ["cross-tenant thread scope check untouched", "async function assertThreadInActiveScope"],
];
const missingPreserved = preserved.filter(([, needle]) => !combined.includes(needle));
if (missingPreserved.length) {
  console.error("Messages archive smoke failed. Pre-existing invariants were removed or renamed:");
  for (const [label, needle] of missingPreserved) console.error(`- ${label}: ${needle}`);
  process.exit(1);
}

console.log("Messages archive smoke passed.");
