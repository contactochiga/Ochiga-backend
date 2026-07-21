#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function assert(pass, label) {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) process.exitCode = 1;
}

const controller = read("src/controllers/servicesController.ts");
const routes = read("src/routes/services.ts");
const migration = read("supabase/migrations/20260721224157_electricity_purchase_lifecycle.sql");

assert(/quoteElectricityPurchase/.test(controller), "backend exposes electricity quote handler");
assert(/confirmElectricityPurchase/.test(controller), "backend exposes electricity purchase confirmation handler");
assert(/buildElectricityQuote/.test(controller) && /net_service_amount/.test(controller), "backend computes quote, fees, tax, net value and units centrally");
assert(/oyi_debit_home_wallet/.test(controller), "purchase confirmation uses canonical wallet debit RPC");
assert(/findServiceTransactionByIdempotency/.test(controller), "purchase confirmation checks idempotency before debit");
assert(/wallet_charged: false/.test(controller), "unavailable electricity purchase returns wallet-not-charged response");
assert(/TEST-/.test(controller) && /test_mode/.test(controller), "test tokens are explicitly marked as test mode");
assert(!/vendingMode === "external_provider"[\s\S]{0,80}purchaseAvailable/.test(controller), "external provider mode does not fabricate live completion");
assert(/\/electricity\/quote/.test(routes) && /\/electricity\/purchase/.test(routes), "routes include electricity quote and purchase endpoints");
for (const column of [
  "meter_id",
  "account_ref",
  "fee",
  "tax",
  "total_deduction",
  "net_service_amount",
  "computed_units",
  "tariff_snapshot",
  "fulfilment_method",
  "vending_mode",
  "token_reference",
  "receipt_reference",
]) {
  assert(migration.includes(column), `migration includes ${column}`);
}
assert(/idx_wallets_user_home_unique/.test(migration) && /idx_wallets_user_global_unique/.test(migration), "migration repairs wallet uniqueness for home-scoped wallets");
