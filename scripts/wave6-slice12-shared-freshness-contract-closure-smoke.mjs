#!/usr/bin/env node
// Wave 6 Slice 12 -- Shared Freshness Contract Closure smoke.
//
// Proves the three defects documented in
// docs/WAVE6_CURRENT_STATE_FRESHNESS_AUDIT.md Section 4.4 (and this
// slice's own brief) are closed:
//
//   A. ReadCapabilityModules.normalizeFreshness defaulted any date-shaped
//      IntelligenceFact.freshness string to "fresh" regardless of age.
//   B. contributorSummary.buildContributorSummary derived aggregate
//      freshness from facts[0] only, making the result order-dependent.
//   C. walletEvidence.loadWalletBalanceFacts defaulted freshness to
//      "fresh" when wallets.updated_at was missing/invalid.
//
// No live database is used for the wallet checks -- supabaseAdmin.from()
// is replaced with a minimal read-only fixture responder (the wallet
// balance loader only ever selects, never writes).
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const path = require("path");
const backendRoot = require("node:url").fileURLToPath(new URL("..", import.meta.url));
require(path.join(backendRoot, "node_modules/dotenv")).config({ path: path.join(backendRoot, ".env") });

let pass = 0;
let fail = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) {
    pass += 1;
    console.log(`PASS ${label}`);
  } else {
    fail += 1;
    failures.push(label);
    console.log(`FAIL ${label}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ""}`);
  }
}

// ---------------------------------------------------------------------
// Minimal read-only supabase mock: .from(table).select(...).eq(...).limit(...)
// resolves to { data, error } for whichever fixture rows are configured
// for that table. Real chainable object (thenable), matching the
// established mock-supabase pattern used across this Wave's smokes.
// ---------------------------------------------------------------------
function makeReadOnlyMock(tableRows) {
  return {
    from(table) {
      const rows = tableRows[table] || [];
      const builder = {
        _rows: rows,
        select() { return builder; },
        eq() { return builder; },
        limit() { return builder; },
        order() { return builder; },
        then(resolve) { return Promise.resolve({ data: builder._rows, error: null }).then(resolve); },
      };
      return builder;
    },
  };
}

async function main() {
  const supabaseClientPath = path.join(backendRoot, "dist/supabase/supabaseClient.js");
  const supabaseClientModule = require(supabaseClientPath);
  const readCapModulePath = path.join(backendRoot, "dist/oyi-core/capabilities/ReadCapabilityModules.js");
  const contributorSummaryModulePath = path.join(backendRoot, "dist/oyi-core/domains/contributorSummary.js");
  const walletEvidenceModulePath = path.join(backendRoot, "dist/oyi-core/domains/wallet/walletEvidence.js");

  const { evidenceFromFact } = require(readCapModulePath);
  const { buildContributorSummary } = require(contributorSummaryModulePath);

  const NOW = Date.now();
  function isoAgo(ms) { return new Date(NOW - ms).toISOString(); }
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  function makeFact(overrides) {
    return {
      fact_id: `fact:${Math.random().toString(36).slice(2)}`,
      domain: "devices",
      fact_type: "device_availability",
      scope: { estate_id: "estate-1", home_id: "home-1", room_id: null },
      object: { object_type: "device", canonical_id: "device-1", label: "Living Room AC" },
      statement: "Living Room AC is on.",
      value: { online: true },
      previous_value: null,
      occurred_at: null,
      observed_at: new Date().toISOString(),
      source_type: "database",
      source_id: "device-1",
      truth_state: "confirmed",
      confidence: 0.9,
      freshness: isoAgo(0),
      privacy_class: "resident_device_private",
      permissions: ["read"],
      evidence: [],
      ...overrides,
    };
  }

  // =====================================================================
  // PART A -- normalizeFreshness / evidenceFromFact (Defect A)
  // =====================================================================
  console.log("\n=== PART A: normalizeFreshness ===");

  const recentDeviceFact = makeFact({ domain: "devices", freshness: isoAgo(2 * MIN) });
  check("A1 recent ISO timestamp (devices, 2min old) -> fresh", evidenceFromFact(recentDeviceFact).freshness === "fresh", evidenceFromFact(recentDeviceFact).freshness);

  const staleDeviceFact = makeFact({ domain: "devices", freshness: isoAgo(45 * MIN) });
  check("A2 stale ISO timestamp (devices, 45min old, past 15min fresh threshold) -> not fresh", evidenceFromFact(staleDeviceFact).freshness !== "fresh", evidenceFromFact(staleDeviceFact).freshness);
  check("A2b stale ISO timestamp classifies as stale bucket", evidenceFromFact(staleDeviceFact).freshness === "stale", evidenceFromFact(staleDeviceFact).freshness);

  const oldDeviceFact = makeFact({ domain: "devices", freshness: isoAgo(10 * DAY) });
  check("A3 old/historical timestamp (devices, 10 days) classifies per domain policy, not fresh", evidenceFromFact(oldDeviceFact).freshness === "stale", evidenceFromFact(oldDeviceFact).freshness);

  const missingFact = makeFact({ domain: "devices", freshness: null });
  check("A4 missing timestamp -> unknown (honest)", evidenceFromFact(missingFact).freshness === "unknown", evidenceFromFact(missingFact).freshness);

  const invalidFact = makeFact({ domain: "devices", freshness: "not-a-real-date" });
  check("A5 invalid/unparseable timestamp -> unknown (honest)", evidenceFromFact(invalidFact).freshness === "unknown", evidenceFromFact(invalidFact).freshness);

  const alreadyClassifiedStale = makeFact({ domain: "devices", freshness: "stale" });
  check("A6 already-classified bucket 'stale' preserved (not date-parsed)", evidenceFromFact(alreadyClassifiedStale).freshness === "stale", evidenceFromFact(alreadyClassifiedStale).freshness);

  const alreadyClassifiedDisconnected = makeFact({ domain: "devices", freshness: "provider_disconnected" });
  check("A7 already-classified bucket 'provider_disconnected' preserved", evidenceFromFact(alreadyClassifiedDisconnected).freshness === "provider_disconnected", evidenceFromFact(alreadyClassifiedDisconnected).freshness);

  const alreadyClassifiedUnobservable = makeFact({ domain: "devices", freshness: "unobservable" });
  check("A7b already-classified bucket 'unobservable' preserved", evidenceFromFact(alreadyClassifiedUnobservable).freshness === "unobservable", evidenceFromFact(alreadyClassifiedUnobservable).freshness);

  // Domain thresholds preserved: identical 2-hour-old timestamp is "fresh"
  // for maintenance (24h fresh window) but NOT fresh for devices (15min).
  const twoHourOld = isoAgo(2 * HOUR);
  const maintenanceTwoHourFact = makeFact({ domain: "maintenance", freshness: twoHourOld });
  const deviceTwoHourFact = makeFact({ domain: "devices", freshness: twoHourOld });
  check("A8 domain thresholds preserved: 2h-old is fresh for maintenance", evidenceFromFact(maintenanceTwoHourFact).freshness === "fresh", evidenceFromFact(maintenanceTwoHourFact).freshness);
  check("A8b domain thresholds preserved: 2h-old is NOT fresh for devices", evidenceFromFact(deviceTwoHourFact).freshness !== "fresh", evidenceFromFact(deviceTwoHourFact).freshness);

  // =====================================================================
  // PART B -- buildContributorSummary order-independence (Defect B)
  // =====================================================================
  console.log("\n=== PART B: buildContributorSummary order-independence ===");

  const freshFact = makeFact({ domain: "devices", fact_id: "f-fresh", freshness: isoAgo(1 * MIN) });
  const staleFact = makeFact({ domain: "devices", fact_id: "f-stale", freshness: isoAgo(10 * DAY) });
  const unknownFact = makeFact({ domain: "devices", fact_id: "f-unknown", freshness: null });

  function summarize(facts) {
    return buildContributorSummary({ domain: "devices", facts, summary: "test", now: NOW });
  }

  const fwdMixed = summarize([freshFact, staleFact]);
  const revMixed = summarize([staleFact, freshFact]);
  check("B1 [fresh,stale] and [stale,fresh] produce identical aggregate freshness", fwdMixed.freshness === revMixed.freshness, { fwd: fwdMixed.freshness, rev: revMixed.freshness });
  check("B1b mixed fresh+stale aggregate is the worst (stale), not fresh", fwdMixed.freshness === "stale", fwdMixed.freshness);

  const allFresh = summarize([freshFact, makeFact({ domain: "devices", freshness: isoAgo(0) })]);
  check("B2 all-fresh facts -> fresh, deterministic", allFresh.freshness === "fresh", allFresh.freshness);

  const allStale = summarize([staleFact, makeFact({ domain: "devices", freshness: isoAgo(20 * DAY) })]);
  check("B3 all-stale facts -> stale, deterministic", allStale.freshness === "stale", allStale.freshness);

  const freshUnknownFwd = summarize([freshFact, unknownFact]);
  const freshUnknownRev = summarize([unknownFact, freshFact]);
  check("B4 fresh+unknown is truthful (not fresh) regardless of order", freshUnknownFwd.freshness !== "fresh" && freshUnknownRev.freshness !== "fresh", { fwd: freshUnknownFwd.freshness, rev: freshUnknownRev.freshness });
  check("B4b fresh+unknown order-independent", freshUnknownFwd.freshness === freshUnknownRev.freshness, { fwd: freshUnknownFwd.freshness, rev: freshUnknownRev.freshness });

  const staleUnknown = summarize([staleFact, unknownFact]);
  check("B5 stale+unknown truthful (unknown evidence not discarded)", staleUnknown.freshness === "unknown", staleUnknown.freshness);

  const emptySummary = summarize([]);
  check("B6 empty facts array -> unknown (unchanged prior contract)", emptySummary.freshness === "unknown", emptySummary.freshness);

  // =====================================================================
  // PART C -- walletEvidence.loadWalletBalanceFacts (Defect C)
  // =====================================================================
  console.log("\n=== PART C: wallet balance freshness ===");

  const walletMockNoTimestamp = makeReadOnlyMock({
    wallets: [{ id: "wallet-missing-ts", home_id: "home-wallet-1", balance: 15000, currency: "NGN", is_frozen: false, updated_at: null }],
  });
  supabaseClientModule.supabaseAdmin = walletMockNoTimestamp;
  delete require.cache[walletEvidenceModulePath];
  const walletEvidenceMissing = require(walletEvidenceModulePath);
  const missingTsFacts = await walletEvidenceMissing.loadWalletBalanceFacts(
    { estate_id: "estate-1", home_id: "home-wallet-1", context: {} },
    { estate_id: "estate-1", home_id: "home-wallet-1" },
    { conversation_request_id: "req-1", temporal_scope: { mode: "current" } },
  );
  check("C1 wallet row with missing updated_at produces exactly 1 fact", missingTsFacts.length === 1, missingTsFacts.length);
  check("C2 missing observation timestamp does NOT fabricate 'fresh'", missingTsFacts[0]?.freshness !== "fresh", missingTsFacts[0]?.freshness);
  check("C3 missing observation timestamp -> honest 'unknown' sentinel", missingTsFacts[0]?.freshness === "unknown", missingTsFacts[0]?.freshness);
  check("C4 wallet balance value unchanged (direct-query preservation)", missingTsFacts[0]?.value?.balance === 15000 && missingTsFacts[0]?.value?.currency === "NGN", missingTsFacts[0]?.value);

  const realTs = isoAgo(3 * MIN);
  const walletMockWithTimestamp = makeReadOnlyMock({
    wallets: [{ id: "wallet-real-ts", home_id: "home-wallet-2", balance: 42000, currency: "NGN", is_frozen: false, updated_at: realTs }],
  });
  supabaseClientModule.supabaseAdmin = walletMockWithTimestamp;
  delete require.cache[walletEvidenceModulePath];
  const walletEvidenceReal = require(walletEvidenceModulePath);
  const realTsFacts = await walletEvidenceReal.loadWalletBalanceFacts(
    { estate_id: "estate-1", home_id: "home-wallet-2", context: {} },
    { estate_id: "estate-1", home_id: "home-wallet-2" },
    { conversation_request_id: "req-2", temporal_scope: { mode: "current" } },
  );
  check("C5 wallet row WITH real updated_at is unchanged (raw ISO timestamp passed through)", realTsFacts[0]?.freshness === realTs, realTsFacts[0]?.freshness);

  // Feed the real-timestamp wallet fact through evidenceFromFact -- wallet
  // is a HISTORICAL_DOMAINS domain, so contributorSummary always calls it
  // "historical" regardless of age; confirm this pre-existing domain
  // policy is UNCHANGED by this slice's fix (not touched, not widened).
  const walletBucket = evidenceFromFact(realTsFacts[0]);
  check("C6 wallet domain policy unchanged: real-timestamp balance still classifies as 'expired' (historical bucket) via evidenceFromFact", walletBucket.freshness === "expired", walletBucket.freshness);

  // =====================================================================
  // PART D -- Slice 10 device regression, both paths
  // =====================================================================
  console.log("\n=== PART D: Slice 10 device contributor + envelope regression ===");

  const deviceFreshViaContributor = summarize([makeFact({ domain: "devices", freshness: isoAgo(1 * MIN) })]);
  check("D1 contributor path: fresh device timestamp -> fresh", deviceFreshViaContributor.freshness === "fresh", deviceFreshViaContributor.freshness);

  const deviceStaleViaContributor = summarize([makeFact({ domain: "devices", freshness: isoAgo(2 * DAY) })]);
  check("D2 contributor path: stale device timestamp -> stale", deviceStaleViaContributor.freshness === "stale", deviceStaleViaContributor.freshness);

  const deviceFreshViaEnvelope = evidenceFromFact(makeFact({ domain: "devices", freshness: isoAgo(1 * MIN) }));
  check("D3 envelope path: fresh device timestamp -> fresh", deviceFreshViaEnvelope.freshness === "fresh", deviceFreshViaEnvelope.freshness);

  const deviceStaleViaEnvelope = evidenceFromFact(makeFact({ domain: "devices", freshness: isoAgo(2 * DAY) }));
  check("D4 envelope path: stale device timestamp -> stale (not fresh)", deviceStaleViaEnvelope.freshness === "stale", deviceStaleViaEnvelope.freshness);

  // =====================================================================
  // PART E -- Direct-value / privacy / cross-domain preservation
  // =====================================================================
  console.log("\n=== PART E: direct-value and privacy preservation ===");

  const deviceOnFact = makeFact({ domain: "devices", freshness: isoAgo(2 * DAY), value: { online: true, availability: "online" } });
  const deviceOnEvidence = evidenceFromFact(deviceOnFact);
  check("E1 direct device value unchanged despite freshness correction", deviceOnEvidence.payload.fact.value.online === true, deviceOnEvidence.payload.fact.value);

  const visitorFact = makeFact({ domain: "visitors", fact_type: "visitor_access", freshness: isoAgo(2 * DAY), value: { status: "approved" }, privacy_class: "resident_home_private" });
  const visitorEvidence = evidenceFromFact(visitorFact);
  check("E2 visitor status value unchanged", visitorEvidence.payload.fact.value.status === "approved", visitorEvidence.payload.fact.value);

  const maintenanceFact = makeFact({ domain: "maintenance", fact_type: "maintenance_request", freshness: isoAgo(2 * HOUR), value: { status: "in_progress" } });
  const maintenanceEvidence = evidenceFromFact(maintenanceFact);
  check("E3 maintenance status value unchanged", maintenanceEvidence.payload.fact.value.status === "in_progress", maintenanceEvidence.payload.fact.value);

  const financialFact = makeFact({ domain: "wallet", fact_type: "wallet_balance", freshness: isoAgo(0), value: { balance: 500 } });
  const financialEvidence = evidenceFromFact(financialFact);
  check("E4 financial privacy classification unaffected by freshness fix", financialEvidence.privacy_class === "financial_sensitive", financialEvidence.privacy_class);

  // Cross-domain matrix: recent timestamp classifies fresh under each
  // domain's own (unmodified) threshold.
  const crossDomainRecent = ["devices", "security", "maintenance", "utilities", "community"].map((domain) => ({
    domain,
    freshness: evidenceFromFact(makeFact({ domain, freshness: isoAgo(30_000) })).freshness,
  }));
  check("E5 cross-domain matrix: 30s-old timestamp is fresh in every domain", crossDomainRecent.every((r) => r.freshness === "fresh"), crossDomainRecent);

  const crossDomainStaleSecurity = evidenceFromFact(makeFact({ domain: "security", freshness: isoAgo(90 * MIN) })).freshness;
  check("E6 domain threshold difference: 90min-old is stale for security (60min fresh window)", crossDomainStaleSecurity !== "fresh", crossDomainStaleSecurity);

  // =====================================================================
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("Failures:", failures);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Smoke script crashed:", error);
  process.exit(1);
});
