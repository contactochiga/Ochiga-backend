#!/usr/bin/env node
import fs from "fs";
import path from "path";

const controller = fs.readFileSync(path.join(process.cwd(), "src/controllers/walletController.ts"), "utf8");

const requiredFields = [
  "transaction_reference",
  "provider_reference",
  "credited_amount",
  "payment_method",
  "confirmation_source",
];

let failed = 0;
for (const field of requiredFields) {
  const pass = controller.includes(field);
  console.log(`${pass ? "PASS" : "FAIL"} receipt field ${field}`);
  if (!pass) failed += 1;
}

const routePass = /export async function getFundingReceipt/.test(controller);
console.log(`${routePass ? "PASS" : "FAIL"} receipt endpoint export`);
if (!routePass) failed += 1;

process.exit(failed ? 1 : 0);
