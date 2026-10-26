// Isolated setup executable. Never imports app.ts, wallet routes or background workers.
import express from "express";
import fs from "fs";
import { validSignature, paymentCallback } from "./hardwarePayments";
export function assertSetupEnvironment(e: NodeJS.ProcessEnv) {
  if (
    e.HARDWARE_SETUP_ONLY !== "true" ||
    e.HARDWARE_TEST_CALLBACK_ORIGIN !== "https://localhost:18443"
  )
    throw Error("isolated_setup_configuration_required");
  for (const key of [
    "PAYSTACK_SECRET_KEY",
    "PAYSTACK_SECRECT_KEY",
    "DATABASE_URL",
    "OPENAI_API_KEY",
    "RESEND_API_KEY",
  ])
    if (e[key]) throw Error("forbidden_environment_binding");
  for (const key of [
    "HARDWARE_PAYMENT_INITIALIZATION_ENABLED",
    "HARDWARE_PAYMENT_PROCESSING_ENABLED",
    "HARDWARE_FINANCIAL_RECOVERY_ENABLED",
    "HARDWARE_REFUNDS_ENABLED",
  ])
    if (e[key] !== "false")
      throw Error("financial_processing_must_be_disabled");
  if (
    e.SUPABASE_URL !== "http://backend-rest:3000" ||
    !e.SUPABASE_SERVICE_ROLE_KEY ||
    !e.HARDWARE_OFFICE_API_KEY ||
    !e.HARDWARE_PAYSTACK_SECRET_KEY?.startsWith("sk_test_SETUP_")
  )
    throw Error("setup_credentials_required");
  paymentCallback(
    e.HARDWARE_PAYSTACK_CALLBACK_URL || "",
    e.HARDWARE_TEST_CALLBACK_ORIGIN,
  );
}
// Optional real TEST signing key is read from an exact read-only secret mount only.
// It never enters the payment factory/environment and cannot enable processing.
export function setupWebhookSigningKey(e: NodeJS.ProcessEnv, io = fs): string {
  if (!e.HARDWARE_TEST_WEBHOOK_KEY_FILE) return e.HARDWARE_PAYSTACK_SECRET_KEY!;
  if (e.HARDWARE_TEST_WEBHOOK_KEY_FILE !== "/run/secrets/hardware-test-key") throw Error("test_signing_key_mount_required");
  const stat = io.lstatSync(e.HARDWARE_TEST_WEBHOOK_KEY_FILE);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) throw Error("insecure_test_signing_key");
  const key = io.readFileSync(e.HARDWARE_TEST_WEBHOOK_KEY_FILE, "utf8").trim();
  if (!/^sk_test_[A-Za-z0-9_]{12,240}$/.test(key) || key.startsWith("sk_test_SETUP_")) throw Error("dedicated_test_signing_key_required");
  return key;
}
export function setupApp() {
  assertSetupEnvironment(process.env);
  const signingKey = setupWebhookSigningKey(process.env);
  const app = express();
  app.disable("x-powered-by");
  app.get("/healthz", (_q, r) =>
    r.json({ ok: true, mode: "setup-only", transactions: false }),
  );
  app.post(
    "/hardware-payments/webhook",
    express.raw({ type: "application/json", limit: "256kb" }),
    (q, r) => {
      if (
        !validSignature(
          q.body,
          q.headers["x-paystack-signature"],
          signingKey,
        )
      ) {
        r.sendStatus(401);
        return;
      }
      // Even correctly signed events cannot mutate payment records during environment setup.
      r.status(503).json({ error: "setup_only_processing_disabled" });
    },
  );
  const { hardwareRoutes } = require("./hardwarePaymentRoutes");
  app.use(
    "/hardware-payments",
    express.json({ limit: "16kb" }),
    hardwareRoutes(),
  );
  app.use((_q, r) => r.sendStatus(404));
  return app;
}
if (require.main === module) {
  try {
    setupApp().listen(3000, "0.0.0.0");
  } catch {
    console.error("hardware_setup_startup_denied");
    process.exitCode = 1;
  }
}
