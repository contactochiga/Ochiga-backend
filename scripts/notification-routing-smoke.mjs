import assert from "node:assert/strict";
import { normalizeNotificationRouting, legacyNotificationRoutingMapper } from "../dist/services/notifications/notificationRoutingService.js";

function check(name, input, expected) {
  const routing = normalizeNotificationRouting(input);
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(routing[key], value, `${name}: ${key}`);
  return routing;
}

const workflow = check("workflow", {
  type: "system", entity_id: "workflow-1", payload: { routing: { source_type: "workflow", source_id: "workflow-1", attention_eligible: true, queue_eligible: true } },
}, { source_type: "workflow", source_id: "workflow-1", attention_eligible: true, queue_eligible: true });
assert.equal(workflow.target?.target_type, "workflow");

const prediction = check("prediction", {
  type: "system", entity_id: "prediction-1", payload: { routing: { source_type: "prediction", source_id: "prediction-1" } },
}, { source_type: "prediction", source_id: "prediction-1", attention_eligible: true, queue_eligible: false });
assert.equal(prediction.target?.target_type, "prediction");

const incident = check("incident", {
  type: "system", entity_id: "incident-1", payload: { routing: { source_type: "incident", source_id: "incident-1" } },
}, { source_type: "incident", source_id: "incident-1", attention_eligible: true, queue_eligible: true, acknowledgement_required: true });

const maintenance = check("maintenance", {
  type: "maintenance", entity_id: "maintenance-1", payload: { status: "blocked" },
}, { source_type: "maintenance", source_id: "maintenance-1", attention_eligible: true, queue_eligible: true });

const visitor = check("visitor", {
  type: "visitor", entity_id: "visitor-1", payload: { status: "pending" },
}, { source_type: "visitor", source_id: "visitor-1", actionability: "approve", attention_eligible: true, queue_eligible: true });

const message = check("message", {
  type: "system", entity_id: "thread-1", payload: { thread_id: "thread-1", kind: "message" },
}, { source_type: "message", source_id: "thread-1", attention_eligible: false, queue_eligible: false });

const legacy = legacyNotificationRoutingMapper({ type: "visitor", entity_id: "legacy-visitor", payload: { status: "pending" } });
assert.equal(legacy.target?.target_type, "visitor");
assert.equal(legacy.source_id, "legacy-visitor");

console.log("Notification routing smoke passed.");
