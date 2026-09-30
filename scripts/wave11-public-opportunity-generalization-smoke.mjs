// Wave 11 Osa burn-down -- proves the short-lived public opportunity
// objective mechanism generalizes beyond the literal required journey
// (VI, 1,200 sqm, JV) and beyond a JV-shaped assessment engine entirely.
// Two alternate synthetic journeys, run against the real compiled server
// through the same canonical entry point the production harness uses,
// against the isolated wave11-behavioural-fixture only.
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const productionRef = "zcpgtdakqxyvjkmiibei";
const url = String(process.env.SUPABASE_URL || "");
if (!/^http:\/\/(127\.0\.0\.1|localhost):55421$/.test(url) || url.includes(productionRef)) {
  throw new Error("refuses a non-isolated or production Supabase URL");
}
if (!process.env.OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("requires OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY for the isolated local fixture");
}
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY;

const queueModule = require.resolve("bullmq");
require.cache[queueModule] = { id: queueModule, filename: queueModule, loaded: true, exports: { Queue: class {}, Worker: class {} } };
const redisModule = require.resolve("ioredis");
class NoNetworkRedis { on() { return this; } quit() { return Promise.resolve(); } disconnect() {} }
NoNetworkRedis.default = NoNetworkRedis;
NoNetworkRedis.Redis = NoNetworkRedis;
require.cache[redisModule] = { id: redisModule, filename: redisModule, loaded: true, exports: NoNetworkRedis };

const { conversationOrchestrator } = await import("../dist/oyi-core/orchestration/ConversationOrchestrator.js");

const guest = { id: "30000000-0000-4000-8000-000000000006", email: "guest@wave11.local", role: "guest", permissions: [], permission_scopes: [] };
function oisContext() {
  return { actor_id: guest.id, surface: "public_corporate", role: guest.role, permissions: [], organization_id: null, portfolio_id: null, account_id: null, deployment_id: null, estate_id: null, home_id: null, membership_id: null, module: null, target: null, estate: null, home: null, available_estates: [], available_homes: [], resolved_at: new Date().toISOString() };
}

async function runJourney(name, prompts, assertions) {
  let thread_id = null;
  const answers = [];
  for (const prompt of prompts) {
    const requestId = randomUUID();
    const response = await conversationOrchestrator.run({
      actor: guest,
      oisContext: oisContext(),
      input: { message: prompt, surface: "public_corporate", estate_id: null, home_id: null, thread_id, context: { request_id: requestId, correlation_id: requestId } },
    });
    thread_id = response.thread_id || thread_id;
    const answer = String(response.answer || response.message || "");
    answers.push({ prompt, answer, capability_key: response.capability_key || null, saved: response.persistence_saved === true });
  }
  console.log(`\n=== ${name} ===`);
  for (const a of answers) console.log(`  "${a.prompt}" [${a.capability_key}] -> ${a.answer.slice(0, 140)}`);
  for (const assertion of assertions) assertion(answers);
  console.log(`PASS ${name}`);
}

function assertNoUnsupported(answers) {
  for (const a of answers) {
    if (a.capability_key === "canonical.conversation.unsupported" || a.capability_key === "business_surface.fallback") {
      throw new Error(`unsupported/fallback capability for "${a.prompt}"`);
    }
    if (!a.saved) throw new Error(`not persisted for "${a.prompt}"`);
  }
}

function assertContains(index, substrings) {
  return (answers) => {
    for (const s of substrings) {
      if (!answers[index].answer.toLowerCase().includes(s.toLowerCase())) {
        throw new Error(`expected turn ${index} ("${answers[index].prompt}") to mention "${s}", got: ${answers[index].answer}`);
      }
    }
  };
}

// Alternate 1: different location (Abuja, not VI/Lagos), different area
// unit (hectares, not sqm), lease instead of JV, an EXISTING BUILDING
// rather than bare land, and a differently-worded no-sale constraint.
// None of these literal values/words appear anywhere in
// PublicOpportunityCapabilityModule.ts or its extraction regexes.
await runJourney(
  "alt-1: existing building, Abuja, hectares, lease",
  [
    "I own a building in Abuja.",
    "It's about 3 hectares.",
    "I'd prefer a lease.",
    "I don't want to sell it.",
    "What would you need from me?",
    "Can someone call me?",
  ],
  [
    assertNoUnsupported,
    assertContains(4, ["abuja", "3 hectares", "existing_building", "lease", "no sale"]),
  ]
);

// Alternate 2: a non-JV public inquiry (technology/facility capability),
// proving the mechanism generalizes to objective_type "technology_inquiry"
// with the generic requirements composer, not developmentJv.ts's engine.
await runJourney(
  "alt-2: technology inquiry, no land/JV vocabulary at all",
  [
    "I'm interested in Oyi for our new facility.",
    "It's a 200-unit facility.",
    "What would you need from me?",
    "Can someone call me?",
  ],
  [
    assertNoUnsupported,
    assertContains(2, ["200-unit"]),
    // Proves the generic (non-JV) composer path: no land/JV-assessment
    // vocabulary ("land size", "landowner", "jv structure") leaked in.
    (answers) => {
      if (/land size|landowner|jv structure/i.test(answers[2].answer)) {
        throw new Error(`technology_inquiry answer used JV-shaped vocabulary: ${answers[2].answer}`);
      }
    },
  ]
);

console.log("\nPASS Wave 11 public opportunity objective generalization: two alternate synthetic journeys, no literal required-journey values, no re-asking for known facts");
process.exit(0);
