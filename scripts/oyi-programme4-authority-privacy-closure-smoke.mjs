import assert from "node:assert/strict";
import path from "node:path";

const root = process.cwd();
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "programme4-smoke-service-role-key";

const { capabilityService } = await import(path.join(root, "dist/oyi-core/capabilities/CapabilityService.js"));
const { capabilityRegistry } = await import(path.join(root, "dist/oyi-core/capabilities/CapabilityRegistry.js"));

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

function evidence(overrides = {}) {
  return {
    evidence_id: "ev-1",
    domain: "devices",
    type: "status",
    object_type: "device",
    object_id: "dev-1",
    object_ref: { object_type: "device", object_id: "dev-1" },
    source: "domain_adapter",
    source_type: "database",
    source_id: "dev-1",
    observed_at: new Date().toISOString(),
    persisted_at: new Date().toISOString(),
    freshness: "fresh",
    truth_class: "source_record",
    privacy_class: "public",
    permissions: [],
    authorised_scope: { estate_id: "estate-1", home_id: "home-1", room_id: null },
    ...overrides,
  };
}

function ctx(surface, overrides = {}) {
  return {
    actor: { id: "actor-1", role: "resident", home_id: "home-1", estate_id: "estate-1", permissions: [] },
    oisContext: null,
    surface,
    scope: { estate_id: "estate-1", building_id: null, home_id: "home-1", room_id: null },
    ...overrides,
  };
}

const deviceModule = { key: "devices.status.read", domain: "devices", rolloutStatus: "enabled" };
const walletModule = { key: "wallet.balance.read", domain: "wallet", rolloutStatus: "enabled" };

// --- Programme 4 Phase E: privacy evidence restrictions (CapabilityService.assertEvidenceAllowed) ---

check("resident-private evidence is blocked for office_internal surface", () => {
  const result = capabilityService.assertEvidenceAllowed(deviceModule, [evidence({ privacy_class: "resident_private" })], ctx("office_internal"));
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "resident_private_evidence_restricted_to_operational_surfaces");
});

check("resident-private evidence is blocked for public_corporate surface", () => {
  const result = capabilityService.assertEvidenceAllowed(deviceModule, [evidence({ privacy_class: "household_private" })], ctx("public_corporate"));
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "resident_private_evidence_restricted_to_operational_surfaces");
});

check("resident-private evidence is allowed for the owning consumer surface", () => {
  const result = capabilityService.assertEvidenceAllowed(deviceModule, [evidence({ privacy_class: "resident_private" })], ctx("consumer"));
  assert.equal(result.allowed, true);
});

check("resident-private wallet evidence is blocked for facility surface", () => {
  const result = capabilityService.assertEvidenceAllowed(walletModule, [evidence({ privacy_class: "resident_private" })], ctx("facility"));
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "resident_private_financial_evidence_restricted");
});

check("financial-sensitive evidence is blocked for every non-consumer surface", () => {
  for (const surface of ["facility", "office_internal", "public_corporate"]) {
    const result = capabilityService.assertEvidenceAllowed(walletModule, [evidence({ privacy_class: "financial_sensitive" })], ctx(surface));
    assert.equal(result.allowed, false, `expected ${surface} to be denied`);
    assert.equal(result.reason, "financial_evidence_restricted_to_consumer");
  }
});

check("credential-sensitive evidence is never allowed through a read capability, any surface", () => {
  for (const surface of ["consumer", "facility", "office_internal", "public_corporate"]) {
    const result = capabilityService.assertEvidenceAllowed(deviceModule, [evidence({ privacy_class: "credential_sensitive" })], ctx(surface));
    assert.equal(result.allowed, false, `expected ${surface} to be denied`);
    assert.equal(result.reason, "credential_evidence_not_allowed_for_read_capability");
  }
});

check("facility-sensitive evidence is blocked from Office (internal and public-corporate) surfaces", () => {
  for (const surface of ["office_internal", "public_corporate"]) {
    const result = capabilityService.assertEvidenceAllowed(deviceModule, [evidence({ privacy_class: "facility_sensitive" })], ctx(surface));
    assert.equal(result.allowed, false, `expected ${surface} to be denied`);
    assert.equal(result.reason, "facility_sensitive_evidence_restricted_to_operational_surfaces");
  }
});

check("facility-sensitive evidence remains visible to the facility surface itself", () => {
  const result = capabilityService.assertEvidenceAllowed(deviceModule, [evidence({ privacy_class: "facility_sensitive" })], ctx("facility"));
  assert.equal(result.allowed, true);
});

check("public evidence is unrestricted on every surface", () => {
  for (const surface of ["consumer", "facility", "office_internal", "public_corporate"]) {
    const result = capabilityService.assertEvidenceAllowed(deviceModule, [evidence({ privacy_class: "public" })], ctx(surface));
    assert.equal(result.allowed, true, `expected ${surface} to be allowed`);
  }
});

// --- canUse(): surface + scope authority, using a real registered capability ---

capabilityRegistry.register({
  key: "smoke.devices.status.read",
  domain: "devices",
  rolloutStatus: "enabled",
  supported_surfaces: ["consumer", "facility"],
  supports: () => true,
  resolve: async () => ({ status: "answered" }),
  collectEvidence: async () => [],
  buildReadResponse: async () => ({ status: "answered", answer: "ok" }),
});

// Deliberately declares public_corporate in supported_surfaces, simulating a
// future capability module misconfigured to allow it — the domain-based
// blocklist in publicSurfaceDenied() must still catch this as defense in
// depth, independent of what a module author declares.
capabilityRegistry.register({
  key: "smoke.devices.status.read.misconfigured",
  domain: "devices",
  rolloutStatus: "enabled",
  supported_surfaces: ["consumer", "facility", "public_corporate"],
  supports: () => true,
  resolve: async () => ({ status: "answered" }),
  collectEvidence: async () => [],
  buildReadResponse: async () => ({ status: "answered", answer: "ok" }),
});

check("public_corporate surface cannot use an operational device capability, even if misdeclared as supported", () => {
  const result = capabilityService.canUse("smoke.devices.status.read.misconfigured", { actor: null, oisContext: null, surface: "public_corporate" });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "public_corporate_surface_cannot_use_operational_capability");
});

check("a surface not in supported_surfaces is rejected before any privacy/scope check", () => {
  const result = capabilityService.canUse("smoke.devices.status.read", { actor: null, oisContext: null, surface: "office_internal" });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "surface_not_supported");
});

check("a resident requesting a home they do not own is denied", () => {
  const actor = { id: "resident-a", role: "resident", home_id: "home-a", estate_id: "estate-a", permissions: [] };
  const result = capabilityService.canUse("smoke.devices.status.read", {
    actor,
    oisContext: null,
    surface: "consumer",
    scope: { estate_id: "estate-a", building_id: null, home_id: "home-b", room_id: null },
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "home_scope_not_owned_by_actor");
});

check("a resident requesting their own home is allowed through scope/surface checks", () => {
  const actor = { id: "resident-a", role: "resident", home_id: "home-a", estate_id: "estate-a", permissions: [] };
  const result = capabilityService.canUse("smoke.devices.status.read", {
    actor,
    oisContext: null,
    surface: "consumer",
    scope: { estate_id: "estate-a", building_id: null, home_id: "home-a", room_id: null },
  });
  assert.equal(result.allowed, true);
});

if (process.exitCode === 1) {
  console.error("oyi-programme4-authority-privacy-closure-smoke: FAILED");
  process.exit(1);
}
console.log("oyi-programme4-authority-privacy-closure-smoke: PASS");
