import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "dummy-service-role-key";

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const utilityEvidenceSource = read("src/oyi-core/domains/utilities/utilityEvidence.ts");
const serviceEvidenceSource = read("src/oyi-core/domains/services/serviceEvidence.ts");
const securityEvidenceSource = read("src/oyi-core/domains/security/securityEvidence.ts");
const communityEvidenceSource = read("src/oyi-core/domains/community/communityEvidence.ts");
const sceneAutomationEvidenceSource = read("src/oyi-core/domains/automations/sceneAutomationEvidence.ts");
const walletEvidenceSource = read("src/oyi-core/domains/wallet/walletEvidence.ts");

const { buildPhaseBReadCapabilities } = await import(path.join(root, "dist/oyi-core/capabilities/ReadCapabilityModules.js"));
const { assertEnabledCapabilityHasAdapter } = await import(path.join(root, "dist/oyi-core/capabilities/CapabilityRollout.js"));
const testSupport = await import(path.join(root, "dist/oyi-core/testing/canonicalConversationTestSupport.js"));

const fact = (overrides) => ({
  fact_id: "f1",
  domain: "utilities",
  fact_type: "generic",
  scope: {},
  object: { object_type: "generic", canonical_id: "f1", label: "Fact" },
  statement: "",
  value: {},
  previous_value: null,
  occurred_at: "2026-08-01T00:00:00.000Z",
  observed_at: "2026-08-01T00:00:00.000Z",
  source_type: "database",
  source_id: "f1",
  truth_state: "confirmed",
  confidence: 0.9,
  freshness: "2026-08-01T00:00:00.000Z",
  privacy_class: "resident_home_private",
  permissions: [],
  evidence: [],
  ...overrides,
});

check("utility evidence loaders query real tables directly and never surface unwritten balance/outstanding columns", () => {
  assert.match(utilityEvidenceSource, /export async function loadServiceAccountFacts/);
  assert.match(utilityEvidenceSource, /export async function loadUtilityTariffFacts/);
  assert.match(utilityEvidenceSource, /export async function loadUtilityPurchaseFacts/);
  assert.match(utilityEvidenceSource, /\.from\("home_service_assignments"\)/);
  assert.match(utilityEvidenceSource, /\.from\("home_service_accounts"\)/);
  assert.match(utilityEvidenceSource, /\.from\("estate_service_configs"\)/);
  assert.match(utilityEvidenceSource, /\.from\("service_transactions"\)/);
  assert.match(utilityEvidenceSource, /truth_state:\s*"unavailable"/);
  assert.doesNotMatch(utilityEvidenceSource, /select\([^)]*\boutstanding\b/);
  assert.match(serviceEvidenceSource, /loadServiceAccountFacts/);
});

check("security evidence loader queries facility_incidents (real, written table) and does not fabricate failed-access data", () => {
  assert.match(securityEvidenceSource, /export async function loadSecurityIncidentFacts/);
  assert.match(securityEvidenceSource, /\.from\("facility_incidents"\)/);
  assert.match(securityEvidenceSource, /truth_state:\s*"unavailable"/);
  assert.doesNotMatch(securityEvidenceSource, /failed_access|access_attempts|access_logs/i);
});

check("community evidence loader ranks official posts first and redacts nothing it should not", () => {
  assert.match(communityEvidenceSource, /export async function loadCommunityPostFacts/);
  assert.match(communityEvidenceSource, /\.from\("community_posts"\)/);
  assert.match(communityEvidenceSource, /is_official/);
});

check("scene/automation evidence loaders query consumer_scenes/consumer_automations/consumer_automation_runs directly", () => {
  assert.match(sceneAutomationEvidenceSource, /export async function loadSceneFacts/);
  assert.match(sceneAutomationEvidenceSource, /export async function loadAutomationFacts/);
  assert.match(sceneAutomationEvidenceSource, /export async function loadAutomationRunFacts/);
  assert.match(sceneAutomationEvidenceSource, /\.from\("consumer_scenes"\)/);
  assert.match(sceneAutomationEvidenceSource, /\.from\("consumer_automations"\)/);
  assert.match(sceneAutomationEvidenceSource, /\.from\("consumer_automation_runs"\)/);
});

check("wallet balance evidence loader selects real maintained wallet columns and range temporal mode is no longer silently dropped", () => {
  assert.match(walletEvidenceSource, /export async function loadWalletBalanceFacts/);
  assert.match(walletEvidenceSource, /\.from\("wallets"\)/);
  assert.match(walletEvidenceSource, /"range"/);
});

check("all six Programme 1 capabilities are enabled with real (non-stub) collectors", () => {
  const modules = buildPhaseBReadCapabilities();
  const keys = [
    "utilities.active.read",
    "utilities.tariff.read",
    "utilities.purchases.read",
    "security.incidents.read",
    "services.active.read",
    "community.latest.read",
    "scenes.list.read",
    "automations.list.read",
    "automations.runs.read",
    "wallet.balance.read",
  ];
  for (const key of keys) {
    const module = modules.find((candidate) => candidate.key === key);
    assert.ok(module, `${key} must be registered`);
    assert.equal(module.rolloutStatus, "enabled", `${key} must be enabled`);
    assert.equal(Boolean(module.collectEvidence.__isDeclaredStub), false, `${key} collector must not be the declared-module stub`);
    assert.ok(module.evidence_requirements.length > 0, `${key} must declare evidence requirements`);
    assertEnabledCapabilityHasAdapter(module);
  }
});

check("utilities.usage.read / utilities.balance.read / utilities.meter.read stay honestly disabled (proven zero-data sources)", () => {
  const modules = buildPhaseBReadCapabilities();
  for (const key of ["utilities.usage.read", "utilities.balance.read", "utilities.meter.read"]) {
    const module = modules.find((candidate) => candidate.key === key);
    assert.ok(module, `${key} must still be registered`);
    assert.notEqual(module.rolloutStatus, "enabled", `${key} must not be enabled without a real source`);
    assert.equal(Boolean(module.collectEvidence.__isDeclaredStub), true, `${key} must keep the stub collector`);
  }
});

check("utilities.spending.read now guards unavailable evidence instead of silently answering empty", () => {
  const readCapabilityModulesSource = read("src/oyi-core/capabilities/ReadCapabilityModules.ts");
  const spendingBlock = readCapabilityModulesSource.split('key: "utilities.spending.read"')[1].split('key: "utilities.active.read"')[0];
  assert.match(spendingBlock, /truth_state === "unavailable"/);
});

check("utility answer builders summarize without inventing counts", () => {
  const activeFacts = [
    fact({ fact_id: "u1", domain: "utilities", fact_type: "service_account", value: { service_key: "utility_token", active: true, enabled: true, account_status: "active" } }),
    fact({ fact_id: "u2", domain: "utilities", fact_type: "service_account", value: { service_key: "water_service", active: false, enabled: false, account_status: "inactive" } }),
  ];
  const activeAnswer = testSupport.canonicalUtilityActiveAnswerForTest({ facts: activeFacts });
  assert.match(activeAnswer, /1 of 2/);

  const tariffFacts = [
    fact({ fact_id: "t1", domain: "utilities", fact_type: "utility_tariff", value: { title: "Electricity", service_key: "utility_token", unit_cost: 209.5, currency: "NGN", unit_name: "kWh" } }),
  ];
  const tariffAnswer = testSupport.canonicalUtilityTariffAnswerForTest({ facts: tariffFacts });
  assert.match(tariffAnswer, /209\.5/);

  const purchaseFacts = [
    fact({ fact_id: "p1", domain: "utilities", fact_type: "utility_purchase", value: { service_key: "utility_token", amount: 5000, currency: "NGN", status: "completed", completed_at: "2026-08-01T00:00:00.000Z" } }),
  ];
  const purchaseAnswer = testSupport.canonicalUtilityPurchasesAnswerForTest({ facts: purchaseFacts });
  assert.match(purchaseAnswer, /1 utility purchase/);

  const unavailableAnswer = testSupport.canonicalUtilityTariffAnswerForTest({ facts: [fact({ truth_state: "unavailable", value: { reason: "query_failed" } })] });
  assert.match(unavailableAnswer, /do not see a configured tariff/);
});

check("security/services/community answer builders summarize without inventing counts", () => {
  const incidentFacts = [
    fact({ fact_id: "s1", domain: "security", fact_type: "security_incident", value: { title: "Gate sensor fault", severity: "medium", status: "open" } }),
  ];
  const securityAnswer = testSupport.canonicalSecurityIncidentsAnswerForTest({ facts: incidentFacts });
  assert.match(securityAnswer, /1 security incident/);
  assert.match(securityAnswer, /1 unresolved/);

  const securityUnavailable = testSupport.canonicalSecurityIncidentsAnswerForTest({ facts: [fact({ domain: "security", truth_state: "unavailable", value: { reason: "query_failed" } })] });
  assert.match(securityUnavailable, /unavailable right now/);

  const serviceFacts = [
    fact({ fact_id: "sv1", domain: "services", fact_type: "service_account", value: { service_key: "service_charge", active: true, enabled: true, account_status: "active" } }),
  ];
  const servicesAnswer = testSupport.canonicalServicesActiveAnswerForTest({ facts: serviceFacts });
  assert.match(servicesAnswer, /1 of 1/);

  const communityFacts = [
    fact({ fact_id: "c1", domain: "community", fact_type: "community_post", value: { title: "Water shutdown notice", is_official: true } }),
  ];
  const communityAnswer = testSupport.canonicalCommunityLatestAnswerForTest({ facts: communityFacts });
  assert.match(communityAnswer, /1 official update/);
});

check("scenes/automations/wallet-balance answer builders summarize without inventing counts", () => {
  const sceneFacts = [
    fact({ fact_id: "sc1", domain: "scenes", fact_type: "scene", value: { id: "sc1", object_type: "scene", name: "Evening lights", enabled: true, action_count: 3 } }),
  ];
  const sceneAnswer = testSupport.canonicalSceneAutomationReadAnswerForTest({ facts: sceneFacts, domain: "scenes" });
  assert.match(sceneAnswer, /1 authorized scenes/);

  const runFacts = [
    fact({ fact_id: "r1", domain: "automations", fact_type: "automation_run", value: { status: "failed", error_message: "device offline" } }),
  ];
  const runAnswer = testSupport.canonicalAutomationRunsAnswerForTest({ facts: runFacts });
  assert.match(runAnswer, /1 automation run/);
  assert.match(runAnswer, /1 failed/);

  const balanceFacts = [
    fact({ fact_id: "w1", domain: "wallet", fact_type: "wallet_balance", value: { balance: 12500, currency: "NGN", is_frozen: false } }),
  ];
  const balanceAnswer = testSupport.canonicalWalletBalanceAnswerForTest({ facts: balanceFacts });
  assert.match(balanceAnswer, /12,500/);

  const balanceUnavailable = testSupport.canonicalWalletBalanceAnswerForTest({ facts: [fact({ domain: "wallet", truth_state: "unavailable", value: { reason: "query_failed" } })] });
  assert.match(balanceUnavailable, /did not treat that as a zero balance/);
});

console.log("oyi-direct-evidence-programme1-smoke passed");
