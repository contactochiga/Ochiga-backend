#!/usr/bin/env node
import fs from "fs";
import path from "path";

const requiredFiles = [
  ".github/workflows/backend-ci.yml",
  "docs/backend-deployment-checklist.md",
  "docs/rollback-checklist.md",
  "docs/env-variable-checklist.md",
  "docs/monitoring-checklist.md",
  "docs/release-gates.md",
  "docs/security-hardening-phase3-audit.md",
  "docs/device-intelligence-layer-audit.md",
  "docs/backend-v1-completion-audit.md",
];

let failures = 0;
for (const file of requiredFiles) {
  const full = path.join(process.cwd(), file);
  const pass = fs.existsSync(full);
  console.log(`${pass ? "PASS" : "FAIL"} ${file}`);
  if (!pass) failures += 1;
}

process.exit(failures ? 1 : 0);
