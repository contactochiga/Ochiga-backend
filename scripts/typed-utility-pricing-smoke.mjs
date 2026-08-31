#!/usr/bin/env node
// Facility <-> Consumer Utilities acceptance. Root cause: every utility
// type shared one generic unit_cost/unit_name pair (estate_service_configs)
// plus an ad hoc metadata.electricity JSON blob that only electricity ever
// read -- confirmed against production (the real estate has exactly one
// service config row at all). This introduces a typed pricing model
// (service_pricing_plans) and proves the electricity eligibility/quote
// logic actually reads it, without needing to mock the full Express +
// Supabase + notification stack: buildElectricityQuote/
// electricityPolicyFromConfig/pricingSummaryFor are pure functions of
// their inputs, exported specifically so this can test the real logic
// directly. DB-level guarantees (estate scoping, the stale-constraint
// fix, the idempotency unique index, additive/deterministic backfill)
// were proven separately via a rolled-back transaction against the real
// linked production schema before this migration was committed (not
// re-run here -- that was a one-time schema/constraint verification, not
// a repeatable source-level test).
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "local-smoke-service-role-key";
process.env.APP_JWT_SECRET ||= "local-smoke-jwt-secret";
process.env.REDIS_ENABLED = "false";

const {
  buildElectricityQuote,
  electricityPolicyFromConfig,
  pricingSummaryFor,
} = await import("../dist/controllers/servicesController.js");

const failures = [];
function need(condition, message) {
  if (!condition) failures.push(message);
}

function usageBasedPlan(overrides = {}) {
  return {
    id: "plan-1",
    estate_id: "estate-1",
    service_key: "utility_token",
    pricing_type: "usage_based",
    plan_name: null,
    unit_name: "kWh",
    currency: "NGN",
    rate_amount: 225,
    billing_frequency: null,
    payment_timing: "prepaid",
    provider: "EKEDC Distribution Tariff",
    effective_from: "2026-08-01T00:00:00.000Z",
    effective_to: null,
    active: true,
    ...overrides,
  };
}

function configWithPlans(plans, configOverrides = {}) {
  return {
    estate_id: "estate-1",
    service_key: "utility_token",
    title: "Electricity",
    description: "",
    suggested_amount: 5000,
    currency: "NGN",
    active: true,
    account_label: "",
    account_hint: "",
    payment_mode: "wallet_only",
    unit_cost: null,
    unit_name: null,
    billing_mode: "metered",
    metadata: { electricity: { resident_purchases_enabled: true, vending_mode: "test" } },
    pricing_plans: plans,
    ...configOverrides,
  };
}

// 1. Electricity reads its rate/unit/provider from the typed pricing
// plan, independent of the legacy unit_cost column (left null here on
// purpose, to prove the plan -- not the legacy field -- is authoritative).
{
  const config = configWithPlans([usageBasedPlan()]);
  const policy = electricityPolicyFromConfig(config);
  need(policy.tariffPerKwh === 225, `expected tariff 225 from the typed plan, got ${policy.tariffPerKwh}`);
  need(policy.unitName === "kWh", `expected unit_name kWh from the typed plan, got ${policy.unitName}`);
  need(policy.provider === "EKEDC Distribution Tariff", `expected provider from the typed plan, got ${policy.provider}`);
}

// 2/3. Water and Gas can independently carry their own rate/unit -- proven
// via the same pricingSummaryFor() helper Consumer's registry response
// uses, with completely different units/rates than electricity.
{
  const waterConfig = configWithPlans(
    [usageBasedPlan({ id: "plan-water", service_key: "water_service", unit_name: "m3", rate_amount: 180, provider: null })],
    { service_key: "water_service" }
  );
  const gasConfig = configWithPlans(
    [usageBasedPlan({ id: "plan-gas", service_key: "gas_service", unit_name: "kg", rate_amount: 900, provider: null })],
    { service_key: "gas_service" }
  );
  const waterSummary = pricingSummaryFor(waterConfig);
  const gasSummary = pricingSummaryFor(gasConfig);
  need(waterSummary.unit_name === "m3" && waterSummary.rate_amount === 180, "water must carry its own m3 rate, independent of electricity");
  need(gasSummary.unit_name === "kg" && gasSummary.rate_amount === 900, "gas must carry its own kg rate, independent of water/electricity");
  need(waterSummary.rate_amount !== gasSummary.rate_amount, "water and gas rates must not collapse into the same universal number");
}

// 4. Internet/Fibre gets subscription/plan semantics, not a kWh-style
// single tariff -- multiple simultaneous plans, no single "rate_amount".
{
  const internetConfig = configWithPlans(
    [
      { ...usageBasedPlan({ id: "plan-100", service_key: "internet_service" }), pricing_type: "subscription", plan_name: "100 Mbps", rate_amount: 35000, billing_frequency: "monthly", unit_name: null },
      { ...usageBasedPlan({ id: "plan-200", service_key: "internet_service" }), pricing_type: "subscription", plan_name: "200 Mbps", rate_amount: 55000, billing_frequency: "monthly", unit_name: null },
    ],
    { service_key: "internet_service" }
  );
  const summary = pricingSummaryFor(internetConfig);
  need(summary.pricing_type === "subscription", "internet must be classified as subscription, not a metered tariff");
  need(Array.isArray(summary.plans) && summary.plans.length === 2, "internet must expose multiple simultaneous plans");
  need(!("rate_amount" in summary), "a subscription summary must not carry a single universal rate_amount");
}

// 5. Service Charge / recurring pricing is expressed distinctly too (no
// unit_name, a billing_frequency instead) -- proven via the same shared
// helper so this doesn't require a second bespoke code path.
{
  const feeConfig = configWithPlans(
    [{ ...usageBasedPlan({ id: "plan-fee", service_key: "service_charge", unit_name: null, rate_amount: 500000, billing_frequency: "monthly", pricing_type: "recurring", provider: null }) }],
    { service_key: "service_charge" }
  );
  const summary = pricingSummaryFor(feeConfig);
  need(summary.pricing_type === "recurring", "service charge must be recurring, not usage_based");
  need(summary.unit_name == null, "service charge must not pretend to be metered consumption");
  need(summary.billing_frequency === "monthly", "service charge must carry a real billing frequency");
}

// 8/9. Eligible electricity enables Buy Electricity; missing prerequisites
// produce an explicit, distinguishable reason -- never a silent false.
{
  const eligible = buildElectricityQuote({
    amount: 5000,
    config: configWithPlans([usageBasedPlan()]),
    meterId: "43876018367",
    accountRef: "43876018367",
    wallet: { id: "wallet-1", balance: 100000, currency: "NGN" },
  });
  need(eligible.purchase_available === true, "a fully-configured, linked, in-range purchase must be available");
  need(eligible.unavailable_reason === null, "an available purchase must not carry a leftover unavailable_reason");
  need(eligible.tariff.rate === 225 && eligible.tariff.unit_name === "kWh", "the quote's tariff must reflect the typed plan");

  const noMeter = buildElectricityQuote({
    amount: 5000,
    config: configWithPlans([usageBasedPlan()]),
    meterId: "",
    accountRef: "",
    wallet: { id: "wallet-1", balance: 100000, currency: "NGN" },
  });
  need(noMeter.purchase_available === false && noMeter.unavailable_reason === "meter_not_linked", `expected meter_not_linked, got ${noMeter.unavailable_reason}`);

  const noTariff = buildElectricityQuote({
    amount: 5000,
    config: configWithPlans([]),
    meterId: "43876018367",
    accountRef: "43876018367",
    wallet: { id: "wallet-1", balance: 100000, currency: "NGN" },
  });
  need(noTariff.purchase_available === false && noTariff.unavailable_reason === "tariff_not_configured", `expected tariff_not_configured, got ${noTariff.unavailable_reason}`);

  const purchasesDisabled = buildElectricityQuote({
    amount: 5000,
    config: configWithPlans([usageBasedPlan()], { metadata: { electricity: { resident_purchases_enabled: false, vending_mode: "test" } } }),
    meterId: "43876018367",
    accountRef: "43876018367",
    wallet: { id: "wallet-1", balance: 100000, currency: "NGN" },
  });
  need(purchasesDisabled.purchase_available === false && purchasesDisabled.unavailable_reason === "resident_purchases_disabled", `expected resident_purchases_disabled, got ${purchasesDisabled.unavailable_reason}`);

  const noVendingMode = buildElectricityQuote({
    amount: 5000,
    config: configWithPlans([usageBasedPlan()], { metadata: { electricity: { resident_purchases_enabled: true } } }),
    meterId: "43876018367",
    accountRef: "43876018367",
    wallet: { id: "wallet-1", balance: 100000, currency: "NGN" },
  });
  need(noVendingMode.purchase_available === false && noVendingMode.unavailable_reason === "provider_not_configured", `expected provider_not_configured (matches production: this is exactly the real, unconfigured estate's state), got ${noVendingMode.unavailable_reason}`);
}

// 15. Provider/vending failure must never be reported as success -- the
// quote's own purchase_available/unavailable_reason must be internally
// consistent (never both "available" and carrying a failure reason).
{
  const quote = buildElectricityQuote({
    amount: 5000,
    config: configWithPlans([usageBasedPlan()], { active: false }),
    meterId: "43876018367",
    accountRef: "43876018367",
    wallet: { id: "wallet-1", balance: 100000, currency: "NGN" },
  });
  need(quote.purchase_available === false, "a disabled service config must never report purchase_available");
  need(typeof quote.unavailable_reason === "string" && quote.unavailable_reason.length > 0, "an unavailable quote must always carry a machine-readable reason");
}

// Safety-mechanism source checks: payServiceFromWallet must use the
// atomic RPC debit and a pre-charge idempotency lookup -- not the old
// non-atomic read-then-write, and not silently skip idempotency the way
// this endpoint used to.
{
  const fs = await import("node:fs");
  const path = await import("node:path");
  const source = fs.readFileSync(path.join(process.cwd(), "src/controllers/servicesController.ts"), "utf8");
  const fnMatch = source.match(/export async function payServiceFromWallet[\s\S]*?\n}\n/);
  if (!fnMatch) {
    failures.push("could not locate payServiceFromWallet in servicesController.ts");
  } else {
    const fn = fnMatch[0];
    need(/findServiceTransactionByIdempotency/.test(fn), "payServiceFromWallet must check for an existing transaction by idempotency key before charging");
    need(/debitHomeWallet\(/.test(fn), "payServiceFromWallet must use the atomic debitHomeWallet RPC wrapper, not a manual balance read-then-write");
    need(!/\.from\("wallets"\)\s*\.update\(\{\s*balance:/.test(fn), "payServiceFromWallet must not perform a non-atomic wallets.update({balance}) -- reintroduces the race condition this fix closes");
  }
}

if (failures.length) {
  console.error("typed-utility-pricing-smoke: FAILED");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log("typed-utility-pricing-smoke: ALL PASSED");
process.exit(0);
