#!/usr/bin/env node
import fs from "fs";
import path from "path";

const controller = fs.readFileSync(path.join(process.cwd(), "src/controllers/walletController.ts"), "utf8");

const checks = [
  ["paystack signature verification", /x-paystack-signature/.test(controller) && /createHmac\("sha512"/.test(controller)],
  ["completed status short-circuit", /existingStatus === "completed"/.test(controller)],
  ["crediting transition guard", /updateWalletTransactionWithFallback\([\s\S]*\["initialized", "pending", "confirming", "failed"\]/.test(controller)],
  ["webhook handler uses reconcile flow", /confirmationSource: "paystack_webhook"/.test(controller)],
];

let failed = 0;
for (const [label, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) failed += 1;
}
process.exit(failed ? 1 : 0);
