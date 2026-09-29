import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("../src/automations/automations.route.ts", import.meta.url), "utf8");
const capability = await readFile(new URL("../src/oyi-core/capabilities/AutomationSuggestionCapability.ts", import.meta.url), "utf8");
const orchestrator = await readFile(new URL("../src/oyi-core/orchestration/ConversationOrchestrator.ts", import.meta.url), "utf8");

assert.match(route, /conversationOrchestrator\.run\(/, "automation suggestion route must enter canonical Core");
assert.doesNotMatch(route, /nluToAutomation\(/, "HTTP route must not call the model parser directly");
const suggestionRoute = route.slice(route.indexOf('"/ai-suggest"'), route.indexOf('"/:id/trigger"'));
assert.doesNotMatch(suggestionRoute, /\.from\("automations"\)\s*\.insert/, "suggestion route must not persist executable automations");
assert.match(route, /const estateId = actor\.estate_id/, "scope must be server-derived");
assert.match(capability, /permission_requirements: \["devices\.control"\]/, "capability requires governed control authority");
assert.match(capability, /risk_class: "read"/, "a proposal-only parser must not advertise execution authority");
assert.match(capability, /persistence_authority: "manual_or_governed_workflow"/, "parser output cannot grant persistence authority");
assert.match(orchestrator, /buildAutomationSuggestionCapability\(\)/, "capability must be registered by canonical Core");
console.log("PASS Wave 10 automation suggestion authority guard");
