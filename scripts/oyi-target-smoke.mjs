import assert from "node:assert/strict";
import { decorateOyiTargets, normalizeOyiTarget } from "../dist/services/oyi/oyiTargetService.js";

const workflow = normalizeOyiTarget({ type: "workflow", workflow_id: "wf-1" });
assert.deepEqual(workflow, { target_type: "workflow", target_id: "wf-1", open_as: "drawer", action: "inspect" });

const prediction = normalizeOyiTarget({ type: "prediction", prediction_id: "prediction-1" });
assert.equal(prediction.target_type, "prediction");
assert.equal(prediction.target_id, "prediction-1");

for (const [type, source] of [["infrastructure", "devices"], ["infrastructure", "cameras"], ["infrastructure", "edge"]]) {
  const target = normalizeOyiTarget({ type, infrastructure_source: source });
  assert.equal(target.target_type, "infrastructure");
  assert.equal(target.infrastructure_source, source);
}

for (const [type, key] of [["maintenance", "request_id"], ["visitor", "visitor_id"], ["device", "device_id"], ["wallet", "transaction_id"], ["service", "service_id"], ["message", "thread_id"], ["community", "post_id"]]) {
  const target = normalizeOyiTarget({ type, [key]: `${type}-1` });
  assert.equal(target.target_type, type);
  assert.equal(target.target_id, `${type}-1`);
}

assert.deepEqual(normalizeOyiTarget({}), { target_type: "none", open_as: "none" });
const decorated = decorateOyiTargets({ cards: [{ type: "maintenance", items: [{ request_id: "request-2", title: "Leak" }] }], suggested_actions: [{ label: "Open maintenance", route: "/maintenance" }] });
assert.equal(decorated.cards[0].items[0].target.target_type, "maintenance");
assert.equal(decorated.suggested_actions[0].target.target_type, "maintenance");
assert.equal(decorateOyiTargets({ cards: [{ type: "list", items: [{ workflow_id: "wf-2" }] }] }).cards[0].items[0].target.target_type, "workflow");

console.log("Oyi typed target smoke passed.");
