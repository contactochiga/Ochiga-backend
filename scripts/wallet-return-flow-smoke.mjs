#!/usr/bin/env node
import fs from "fs";
import path from "path";

const controller = fs.readFileSync(path.join(process.cwd(), "src/controllers/walletController.ts"), "utf8");

const checks = [
  ["payment return helper", /function paymentReturnUrl/.test(controller)],
  ["consumer return route", /\/wallet\/payment\/return/.test(controller)],
  ["funding state messaging", /Confirming your payment/.test(controller) && /Payment successful/.test(controller)],
  ["public payment state", /function publicFundingState/.test(controller)],
];

let failed = 0;
for (const [label, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) failed += 1;
}
process.exit(failed ? 1 : 0);
