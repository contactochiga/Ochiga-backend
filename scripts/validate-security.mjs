#!/usr/bin/env node
import fs from "fs";
import path from "path";

const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));

function read(file) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

function exists(file) {
  return fs.existsSync(path.join(process.cwd(), file));
}

const checks = [
  {
    label: "JWT verification enforced in auth middleware",
    pass: /jwt\.verify\(/.test(read("src/middleware/auth.ts")),
    critical: true,
  },
  {
    label: "Socket auth verifies JWT",
    pass: /jwt\.verify\(/.test(read("src/socketAuth.ts")),
    critical: true,
  },
  {
    label: "Permission guard present",
    pass: /requirePermission/.test(read("src/middleware/auth.ts")) && /hasPermission/.test(read("src/middleware/auth.ts")),
    critical: true,
  },
  {
    label: "CORS allowlist configured",
    pass: /allowList/.test(read("src/app.ts")) && /cors\(/.test(read("src/app.ts")),
    critical: true,
  },
  {
    label: "Helmet enabled",
    pass: /helmet\(/.test(read("src/app.ts")),
    critical: true,
  },
  {
    label: "Audit logging path exists",
    pass: /audit_events/.test(read("src/core/foundation/audit.ts")),
    critical: true,
  },
  {
    label: "Realtime consumers do not import server singleton directly",
    pass: !/from "..\/server"/.test(read("src/services/NotificationService.ts")) &&
      !/from "..\/server"/.test(read("src/controllers/messagesController.ts")) &&
      !/from "..\/server"/.test(read("src/controllers/geoController.ts")) &&
      !/from "..\/server"/.test(read("src/controllers/deviceGeoController.ts")),
    critical: true,
  },
];

const warnings = [];
if (!("express-rate-limit" in (pkg.dependencies || {})) && !("rate-limiter-flexible" in (pkg.dependencies || {}))) {
  warnings.push("Rate limiting middleware is not installed; release should stay behind upstream protection until added.");
}
if ((pkg.dependencies || {})["aws-sdk"]) {
  warnings.push("aws-sdk v2 is still present; migrate to v3 before long-term production hardening.");
}
if (!exists(".github/workflows/backend-ci.yml")) {
  warnings.push("Backend CI workflow is missing.");
}

let failures = 0;
for (const check of checks) {
  console.log(`${check.pass ? "PASS" : "FAIL"} ${check.label}`);
  if (!check.pass && check.critical) failures += 1;
}
for (const warning of warnings) {
  console.log(`WARN ${warning}`);
}

process.exit(failures ? 1 : 0);
