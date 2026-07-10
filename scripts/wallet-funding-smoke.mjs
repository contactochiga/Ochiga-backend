#!/usr/bin/env node
import fs from "fs";
import path from "path";

const controller = fs.readFileSync(path.join(process.cwd(), "src/controllers/walletController.ts"), "utf8");
const routes = fs.readFileSync(path.join(process.cwd(), "src/routes/wallets.ts"), "utf8");

const checks = [
  ["init payment exported", /export async function initPayment/.test(controller)],
  ["pending transaction bootstrap", /ensureFundingTransaction/.test(controller)],
  ["wallet reconcile path", /reconcileWalletFunding/.test(controller)],
  ["payment status route", /payment-status\/:reference/.test(routes)],
  ["receipt route", /receipts\/:reference/.test(routes)],
];

let failed = 0;
for (const [label, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) failed += 1;
}
process.exit(failed ? 1 : 0);
