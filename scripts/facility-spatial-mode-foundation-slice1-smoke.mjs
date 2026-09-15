// Facility Spatial Mode Convergence, Foundation Slice 1.
//
// Focused coverage for the additive-only changes made in this slice:
//   1. OyiDomain gains exactly one new "digital_twin" member.
//   2. DOMAIN_CAPABILITIES has a real, read-only entry for it (no
//      mutations/executable capability registered yet).
//   3. SignalOrigin gains exactly one new "twin_engine" member, and
//      normalizeSignal() honors it explicitly rather than falling through
//      to heuristic guessing.
//   4. SignalSource gains an explicit "digital_twin" literal.
// This does NOT test any resolver, route, or capability module -- none
// exist yet in this slice.
import assert from "node:assert/strict";
import path from "node:path";

const root = process.cwd();

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const languageUnderstandingSource = (await import("node:fs")).readFileSync(
  path.join(root, "src/oyi-core/runtime/languageUnderstanding.ts"),
  "utf8"
);

// Strip full-line "//" comments before scanning for actual union members --
// this file's own rationale comments legitimately mention the rejected
// names ("spatial", "twin", "spatial_twin") in prose, which must not be
// mistaken for a second competing union member.
const languageUnderstandingCode = languageUnderstandingSource
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

check("OyiDomain union declares exactly one digital_twin member", () => {
  const matches = languageUnderstandingCode.match(/"digital_twin"/g) || [];
  assert.equal(matches.length, 1, `expected exactly 1 occurrence of "digital_twin" in languageUnderstanding.ts's actual code, found ${matches.length}`);
  assert.ok(!/\|\s*"spatial"|\|\s*"twin"|\|\s*"spatial_twin"/.test(languageUnderstandingCode), "no competing domain union member (spatial/twin/spatial_twin) should appear in languageUnderstanding.ts");
});

const { getDomainCapability, DOMAIN_CAPABILITIES } = await import(path.join(root, "dist/oyi-core/runtime/domainCapabilityRegistry.js"));

check("DOMAIN_CAPABILITIES registers digital_twin exactly once", () => {
  const matches = DOMAIN_CAPABILITIES.filter((c) => c.domain === "digital_twin");
  assert.equal(matches.length, 1, `expected exactly 1 digital_twin entry in DOMAIN_CAPABILITIES, found ${matches.length}`);
});

check("digital_twin domain capability is read-only -- no executable capability registered yet", () => {
  const capability = getDomainCapability("digital_twin");
  assert.ok(capability, "getDomainCapability('digital_twin') must resolve to a real entry");
  assert.deepEqual(capability.mutations, [], "digital_twin must not declare any mutation yet");
  assert.deepEqual(capability.drafts, [], "digital_twin must not declare any draft yet");
  assert.deepEqual(capability.requires_approval, [], "digital_twin must not declare any approval-requiring action yet");
  assert.ok(capability.unsupported.includes("execute"), "digital_twin must explicitly disclose 'execute' as unsupported until a real Spatial capability module ships");
});

check("getDomainCapability for every pre-existing domain is unaffected", () => {
  for (const domain of ["home", "devices", "rooms", "maintenance", "global"]) {
    assert.ok(getDomainCapability(domain), `${domain} must still resolve exactly as before`);
  }
});

const { normalizeSignal } = await import(path.join(root, "dist/oyi-core/contracts/operationalSignal.js"));

check("a Twin-originated signal self-identifies as twin_engine, not facility_app", () => {
  const signal = normalizeSignal({
    type: "operational",
    domain: "digital_twin",
    source: "digital_twin",
    origin: "twin_engine",
    entity: { id: "home-1", type: "home" },
  });
  assert.equal(signal.origin, "twin_engine", `expected origin "twin_engine", got "${signal.origin}"`);
  assert.equal(signal.source, "digital_twin");
});

check("existing signal origins are unaffected by the new twin_engine literal", () => {
  const facilitySignal = normalizeSignal({ type: "operational", domain: "devices", source: "device_adapter", origin: "facility_app" });
  assert.equal(facilitySignal.origin, "facility_app");
  const physicalSignal = normalizeSignal({ type: "operational", domain: "devices", source: "tuya", metadata: { device_state: true } });
  assert.equal(physicalSignal.origin, "physical");
});

console.log("facility-spatial-mode-foundation-slice1-smoke passed");
