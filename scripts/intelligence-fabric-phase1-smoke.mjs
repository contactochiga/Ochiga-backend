import assert from "node:assert/strict";

// Structural smoke only: these inert values allow the Supabase client module to load.
process.env.SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "local-smoke-key";

const eventBus = await import("../dist/intelligence-core/eventBus.js");
const surfaces = await import("../dist/intelligence-core/surfaceRegistry.js");
const publisher = await import("../dist/intelligence-core/sourceEventPublisher.js");

assert.equal(eventBus.normalizeIntelligenceCategory("visitor_access"), "visitor");
assert.equal(eventBus.normalizeIntelligenceCategory("wallet.service_payment.updated"), "wallet");
assert.equal(eventBus.normalizeIntelligenceCategory("device.command.executed"), "device");
assert.equal(surfaces.getOyiSurfaceDefinition("facility").fallback_behavior, "operational");
assert.equal(surfaces.getOyiSurfaceDefinition("oma").memory_scopes.includes("lead"), true);

const invalid = await publisher.publishSourceIntelligenceEvent({
  source: "consumer",
  event_type: "",
  category: "system",
  title: "",
});
assert.equal(invalid.skipped, true);

console.log("intelligence fabric phase 1 smoke passed");
