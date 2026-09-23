#!/usr/bin/env node
// Wave 6 Slice 10 -- Device Contributor Freshness Closure smoke.
//
// Proves loadHomeDeviceInventoryFacts (src/oyi-core/domains/devices/deviceEvidence.ts)
// now preserves the real observation freshness into IntelligenceFact.freshness
// (a raw timestamp-or-"unknown" contract) instead of collapsing it to the
// pre-classified bucket word "fresh"/"stale"/"expired"/"unknown", which
// contributorSummary.ts's classifyFreshness() always failed to Date-parse
// and silently forced to "unknown". No live database is used --
// supabaseAdmin.from() is replaced with an in-memory fixture responder.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const path = require("path");
const fs = require("fs");
const backendRoot = "/Users/ochigaidoko/Documents/Ochiga-backend";
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
    console.log(`FAIL ${label}${detail ? ` :: ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------------
// Supabase fixture mock -- same chain shapes as prior Wave 6 slices.
// ---------------------------------------------------------------------
function makeSupabaseMock(handlers) {
  return {
    from(table) {
      const state = { table, filters: {}, ins: {} };
      function resolve() {
        const handler = handlers[table];
        if (!handler) return Promise.resolve({ data: null, error: { message: `no fixture handler for table "${table}"` } });
        return Promise.resolve(handler(state));
      }
      const b = {
        select() { return b; },
        eq(col, val) { state.filters[col] = val; return b; },
        in(col, vals) { state.ins[col] = vals; return b; },
        order() { return b; },
        limit() { return b; },
        maybeSingle() { return resolve(); },
        single() { return resolve(); },
        then(onFulfilled, onRejected) { return resolve().then(onFulfilled, onRejected); },
      };
      return b;
    },
  };
}

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------
const ESTATE_ID = "estate-freshness-0001";
const HOME_RAW = "home-raw-0000"; // direct fact-shape inspection (d1, d2, d3 together)
const HOME_FRESH_FIRST = "home-fresh-first-0001"; // [fresh, domain-stale] -> contributor "fresh"
const HOME_STALE_FIRST = "home-stale-first-0002"; // [domain-stale, fresh] -> contributor "stale"
const HOME_UNAVAILABLE = "home-unavailable-0003"; // [missing timestamp] -> contributor "unavailable"

const nowMs = Date.now();
const isoAgo = (ms) => new Date(nowMs - ms).toISOString();
const FRESH_TS = isoAgo(30 * 1000); // 30s ago -- fresh by every threshold in play
const DOMAIN_STALE_TS = isoAgo(7 * 60 * 60 * 1000); // 7h ago -- local "expired", domain-level "stale" (devices recentHours=6)

function device(id, homeId, overrides) {
  return {
    id, name: `Device ${id}`, estate_id: ESTATE_ID, home_id: homeId, room_id: null,
    parent_device_id: null, is_virtual: false, category: "climate", type: "ac",
    online: true, status: null, capabilities: null, metadata: {},
    last_seen_at: null, updated_at: null,
    ...overrides,
  };
}

const DEVICES = [
  device("raw-fresh", HOME_RAW, { online: true }),
  device("raw-stale", HOME_RAW, { online: false }),
  device("raw-unavailable", HOME_RAW, { online: true }),
  device("ff-1", HOME_FRESH_FIRST, { online: true }),
  device("ff-2", HOME_FRESH_FIRST, { online: true }),
  device("sf-1", HOME_STALE_FIRST, { online: true }),
  device("sf-2", HOME_STALE_FIRST, { online: true }),
  device("ua-1", HOME_UNAVAILABLE, { online: true }),
];

const DEVICE_STATES = [
  { device_id: "raw-fresh", status: null, last_seen: FRESH_TS, updated_at: FRESH_TS },
  { device_id: "raw-stale", status: null, last_seen: DOMAIN_STALE_TS, updated_at: DOMAIN_STALE_TS },
  // raw-unavailable: no state row, and device.last_seen_at/updated_at are null -> observedAt null
  { device_id: "ff-1", status: null, last_seen: FRESH_TS, updated_at: FRESH_TS },
  { device_id: "ff-2", status: null, last_seen: DOMAIN_STALE_TS, updated_at: DOMAIN_STALE_TS },
  { device_id: "sf-1", status: null, last_seen: DOMAIN_STALE_TS, updated_at: DOMAIN_STALE_TS },
  { device_id: "sf-2", status: null, last_seen: FRESH_TS, updated_at: FRESH_TS },
  // ua-1: no state row, device.last_seen_at/updated_at null -> observedAt null
];

const handlers = {
  devices: (state) => ({ data: DEVICES.filter((d) => d.home_id === state.filters.home_id), error: null }),
  device_states: (state) => ({ data: DEVICE_STATES.filter((r) => (state.ins.device_id || []).includes(r.device_id)), error: null }),
};

async function main() {
  const supabaseClientMod = require(path.join(backendRoot, "dist/supabase/supabaseClient.js"));
  supabaseClientMod.supabaseAdmin.from = makeSupabaseMock(handlers).from;

  const deviceEvidenceMod = require(path.join(backendRoot, "dist/oyi-core/domains/devices/deviceEvidence.js"));
  const contributorSummaryMod = require(path.join(backendRoot, "dist/oyi-core/domains/contributorSummary.js"));
  const homeContributorsMod = require(path.join(backendRoot, "dist/oyi-core/domains/roomHome/homeContributors.js"));
  const readCapabilityModulesMod = require(path.join(backendRoot, "dist/oyi-core/capabilities/ReadCapabilityModules.js"));
  const answerPresentationMod = require(path.join(backendRoot, "dist/oyi-core/presentation/conversationAnswerPresentation.js"));

  // =====================================================================
  // PART A -- Raw fact shape (loadHomeDeviceInventoryFacts direct output)
  // =====================================================================
  console.log("\n=== PART A: fact-level freshness/value/provenance ===");
  const rawFacts = await deviceEvidenceMod.loadHomeDeviceInventoryFacts({ home_id: HOME_RAW }, null);
  const freshFact = rawFacts.find((f) => f.source_id === "raw-fresh");
  const staleFact = rawFacts.find((f) => f.source_id === "raw-stale");
  const unavailableFact = rawFacts.find((f) => f.source_id === "raw-unavailable");
  check("fixture sanity: 3 raw facts loaded", rawFacts.length === 3, `got ${rawFacts.length}`);

  // 1. known-fresh observation preserves the real timestamp (not a bucket word) at the contract field.
  check("1. known-fresh observation -> IntelligenceFact.freshness is the raw timestamp, not a bucket word", freshFact?.freshness === FRESH_TS, freshFact?.freshness);
  // 2. and it classifies as contributor-level "fresh" once fed through the real consuming contract.
  check("1b. ...and classifyFreshness(devices, that value) now resolves to \"fresh\" (was always \"unknown\" pre-fix)", contributorSummaryMod.classifyFreshness("devices", freshFact?.freshness, nowMs) === "fresh");

  // 2. known-stale (domain-level) observation preserves the real timestamp and classifies stale.
  check("2. known-stale observation -> IntelligenceFact.freshness is the raw timestamp", staleFact?.freshness === DOMAIN_STALE_TS, staleFact?.freshness);
  check("2b. ...and classifyFreshness(devices, that value) now resolves to \"stale\" (devices recentHours=6h boundary)", contributorSummaryMod.classifyFreshness("devices", staleFact?.freshness, nowMs) === "stale");

  // 3. genuinely-unknown sentinel is still classified honestly by the shared classifier (unit-level proof --
  // for devices specifically, an unparseable/missing timestamp always also sets truth_state "unavailable"
  // at the source (deviceFreshnessFromTimestamp), so the full pipeline test for this case is #4 below; this
  // confirms the classifier itself still treats the literal "unknown" sentinel correctly, which is exactly
  // what the fixed loader now emits whenever observedAt is null.
  check("3. classifyFreshness(devices, \"unknown\") resolves to \"unknown\" (no fabricated freshness)", contributorSummaryMod.classifyFreshness("devices", "unknown", nowMs) === "unknown");

  // 4. unavailable provider (no observation timestamp anywhere) -- existing unavailable semantics preserved,
  // not reinterpreted as fresh or fabricated.
  check("4. missing timestamp -> IntelligenceFact.freshness is the honest \"unknown\" sentinel", unavailableFact?.freshness === "unknown", unavailableFact?.freshness);
  check("4b. missing timestamp -> truth_state remains \"unavailable\" (unchanged by this fix)", unavailableFact?.truth_state === "unavailable");

  // 5. observation timestamp survives into occurred_at unchanged (never silently replaced by a DB updated_at
  // the source contract didn't ask for).
  check("5. observed timestamp preserved at occurred_at (fresh)", freshFact?.occurred_at === FRESH_TS);
  check("5b. observed timestamp preserved at occurred_at (stale)", staleFact?.occurred_at === DOMAIN_STALE_TS);

  // 6. source/provenance preserved.
  check("6. source_type/source_id/evidence provenance preserved", freshFact?.source_type === "database" && freshFact?.source_id === "raw-fresh" && freshFact?.evidence?.[0]?.source === "device_states");

  // 7. device state VALUE (online) unchanged -- this is a freshness-only fix, not a device-truth change.
  check("7. device online value unchanged (fresh device online=true)", freshFact?.value?.online === true);
  check("7b. device online value unchanged (stale device online=false)", staleFact?.value?.online === false);

  // 8. representative device state (availability, the only other truth-bearing field IntelligenceFact.value
  // carries for devices -- there is no separate battery/lock field in this contract) computed correctly and
  // untouched by the fix, since canonicalDeviceAvailabilityStatus() runs upstream of the edited line.
  check("8. availability correctly derived for fresh+online -> \"online\"", freshFact?.value?.availability === "online", freshFact?.value?.availability);
  check("8b. availability correctly derived for domain-stale+offline -> \"expired\" (local classifier: 7h > 15min)", staleFact?.value?.availability === "expired", staleFact?.value?.availability);
  check("8c. availability correctly derived for missing timestamp -> \"unknown\" (not fabricated online/offline)", unavailableFact?.value?.availability === "unknown", unavailableFact?.value?.availability);

  // 9/10. no new TTL or classifier introduced -- the EXISTING contributorSummary.ts thresholds still govern
  // classification exactly as before this fix (devices: freshMinutes=15, recentHours=6).
  check("9. existing 15-minute fresh boundary unchanged (14min -> fresh)", contributorSummaryMod.classifyFreshness("devices", isoAgo(14 * 60 * 1000), nowMs) === "fresh");
  check("9b. existing 15-minute fresh boundary unchanged (16min -> recent)", contributorSummaryMod.classifyFreshness("devices", isoAgo(16 * 60 * 1000), nowMs) === "recent");
  check("10. existing 6-hour recent boundary unchanged (5h59m -> recent, 6h1m -> stale)",
    contributorSummaryMod.classifyFreshness("devices", isoAgo(5 * 60 * 60 * 1000 + 59 * 60 * 1000), nowMs) === "recent" &&
    contributorSummaryMod.classifyFreshness("devices", isoAgo(6 * 60 * 60 * 1000 + 60 * 1000), nowMs) === "stale");

  // 12. no privacy change.
  check("12. privacy_class unchanged (resident_device_private)", freshFact?.privacy_class === "resident_device_private");
  check("12b. permissions unchanged ([\"read\"])", JSON.stringify(freshFact?.permissions) === JSON.stringify(["read"]));

  // 13. no awareness-identity change where applicable -- device_availability facts are not canonical_awareness
  // facts and do not feed CanonicalAwarenessReadService/buildAmbientAwarenessProjection (confirmed by source
  // read: no import of this loader anywhere under oyi-core/read/ or the canonical awareness services).
  check("13. device facts are not canonical_awareness facts (devices contributor does not feed canonical awareness)", freshFact?.fact_type === "device_availability" && freshFact?.fact_type !== "canonical_awareness");

  // 14. no execution behavior change -- this loader is read-only; confirm no execution/command dispatch import
  // exists in the edited source file.
  const deviceEvidenceSource = fs.readFileSync(path.join(backendRoot, "src/oyi-core/domains/devices/deviceEvidence.ts"), "utf8");
  check("14. devices evidence loader remains read-only (no execution/command dispatch import)", !/executeDeviceCommand|commandQueue|dispatchCommand/.test(deviceEvidenceSource));

  // =====================================================================
  // PART B -- Downstream consumer: the real, exported HOME_CONTRIBUTORS[0]
  // (devicesContributor), unmodified, called exactly as roomHome
  // aggregation calls it.
  // =====================================================================
  console.log("\n=== PART B: downstream consumer (HOME_CONTRIBUTORS devicesContributor) ===");
  const devicesContributor = homeContributorsMod.HOME_CONTRIBUTORS[0];
  check("fixture sanity: HOME_CONTRIBUTORS[0] is the devices contributor", devicesContributor?.domain === "devices");

  const freshFirst = await devicesContributor.contribute({ input: { home_id: HOME_FRESH_FIRST }, oisContext: null });
  // 11. corrected freshness now propagates to the real consumer -- pre-fix this was unconditionally "unknown"
  // for every device fact regardless of actual observation age.
  check("11. downstream consumer (devicesContributor) freshness=\"fresh\" when the freshest fact leads (was always \"unknown\" pre-fix)", freshFirst.freshness === "fresh", freshFirst.freshness);
  check("11b. downstream consumer status=\"answered\" (not incorrectly \"stale\")", freshFirst.status === "answered", freshFirst.status);

  const staleFirst = await devicesContributor.contribute({ input: { home_id: HOME_STALE_FIRST }, oisContext: null });
  check("11c. downstream consumer freshness=\"stale\" when the stale fact leads (was always \"unknown\" pre-fix)", staleFirst.freshness === "stale", staleFirst.freshness);
  check("11d. downstream consumer status=\"stale\" correctly reflects it (was structurally unreachable pre-fix)", staleFirst.status === "stale", staleFirst.status);

  const unavailableResult = await devicesContributor.contribute({ input: { home_id: HOME_UNAVAILABLE }, oisContext: null });
  // 15. genuinely missing freshness still fails honestly at the aggregate level too -- never fabricated as fresh.
  check("15. downstream consumer with a genuinely-unavailable fact reports status=\"unavailable\" (not fabricated)", unavailableResult.status === "unavailable", unavailableResult.status);
  check("15b. downstream consumer freshness=\"unavailable\" (honest, not fresh)", unavailableResult.freshness === "unavailable", unavailableResult.freshness);

  // =====================================================================
  // PART C -- Section 11 characterization: the "Is my AC on?" direct-query
  // path (ReadCapabilityModules.evidenceFromFact / normalizeFreshness).
  // This slice does NOT fix normalizeFreshness (a separate, shared,
  // multi-domain function -- out of this slice's scope per Section 5/11).
  // These checks empirically characterize, rather than fix, its interaction
  // with the corrected fact shape, so the "does not worsen" claim in the
  // final report is measured, not assumed.
  // =====================================================================
  console.log("\n=== PART C: direct-query path (\"Is my AC on?\") -- characterization only, not a fix ===");
  const freshEvidence = readCapabilityModulesMod.evidenceFromFact(freshFact);
  const staleEvidence = readCapabilityModulesMod.evidenceFromFact(staleFact);
  check("C1. evidence-envelope freshness for the fresh device is \"fresh\" (correct)", freshEvidence.freshness === "fresh", freshEvidence.freshness);
  check("C2. evidence-envelope freshness for the domain-stale device is ALSO \"fresh\" (normalizeFreshness's pre-existing \"any date-string = fresh\" limitation, now reached by devices too -- documented, not fixed here)", staleEvidence.freshness === "fresh", staleEvidence.freshness);
  // The answer TEXT users actually see is unaffected: it is rebuilt from the original, un-normalized fact
  // (stashed at evidence.payload.fact by evidenceFromFact) via factsFromEvidence(), never from
  // evidence.freshness -- confirmed directly against the real presentation function below.
  const recoveredFacts = readCapabilityModulesMod.factsFromEvidence([freshEvidence, staleEvidence]);
  const inventoryAnswer = answerPresentationMod.buildDeviceAvailabilityInventoryAnswer(recoveredFacts, undefined, "");
  check("C3. user-facing answer text still correctly reports the stale/expired device (unaffected by normalizeFreshness's evidence-envelope-only inaccuracy)", /stale or expired/i.test(inventoryAnswer), inventoryAnswer);

  // =====================================================================
  // Summary
  // =====================================================================
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log("Failures:", failures.join(", "));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
