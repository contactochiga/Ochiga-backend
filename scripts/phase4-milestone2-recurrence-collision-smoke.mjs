import assert from "node:assert/strict";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "milestone2-recurrence-collision-smoke-service-role-key";

// Oyi Office Conversational Runtime, Milestone 2 -- generalizes the
// Milestone 1 production bug fix (office_tasks.read wrongly claiming
// "Do that every Friday") to every office_internal single-record read
// module. A scheduling/recurrence reference must never be claimed by
// ANY of these, regardless of which domain is currently active via
// continuity, so the correct automation-suggestion card (built
// independently by corporateOfficeInternalPolicy.ts's toolProposals())
// is never contradicted by a misrouted "I don't have a specific X open
// to check..." primary answer.
const { buildOfficeInternalReadCapabilities } = await import("../dist/oyi-core/capabilities/OfficeCorporateCapabilityModules.js");

const modules = buildOfficeInternalReadCapabilities();
function moduleByKey(key) {
  const found = modules.find((m) => m.key === key);
  assert.ok(found, `${key} must be registered`);
  return found;
}

function frame(domain, normalizedText) {
  return { domain, normalizedText };
}

const cases = [
  { key: "office_automations.read", domain: "automations" },
  { key: "office_meetings.read", domain: "office_meetings" },
  { key: "office_support.read", domain: "office_support" },
  { key: "office_portfolio.read", domain: "office_portfolio" },
  { key: "office_partnerships.read", domain: "corporate_partnerships" },
  { key: "office_documents.read", domain: "office_documents" },
  { key: "office_content.read", domain: "office_content" },
  { key: "office_tasks.read", domain: "office_tasks" },
];

const recurrenceMessages = [
  "Do that every Friday",
  "repeat this weekly",
  "run that monthly",
  "make this recurring",
  "keep doing this every day",
  "set up a rule for this",
];

for (const { key, domain } of cases) {
  const mod = moduleByKey(key);
  for (const message of recurrenceMessages) {
    assert.equal(
      mod.supports(frame(domain, message.toLowerCase())),
      false,
      `${key} must not claim a recurrence reference ("${message}") even with its own domain active`
    );
  }
  // Sanity: the module still claims an ORDINARY single-record question
  // in its own domain -- the guard must not have swallowed everything.
  assert.equal(
    mod.supports(frame(domain, "what is the status of this")),
    true,
    `${key} must still claim an ordinary in-domain question`
  );
}

console.log("phase4-milestone2-recurrence-collision-smoke: PASS");
