#!/usr/bin/env node
import fs from "fs";
import path from "path";

const controller = fs.readFileSync(path.join(process.cwd(), "src/controllers/walletController.ts"), "utf8");

const checks = [
  ["home timeline funding activity", /event_type: "wallet\.funded"/.test(controller)],
  ["notification service funding push", /NotificationService\.sendToUser/.test(controller)],
  ["wallet funded signal", /type: "wallet\.funded"/.test(controller)],
  ["wallet funded intelligence event", /wallet\.transaction\.completed/.test(controller)],
];

let failed = 0;
for (const [label, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) failed += 1;
}
process.exit(failed ? 1 : 0);
