import express from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { paystack } from "../utils/paystack";
import {
  officeCredentialTimingSafeEqual,
  resolveOfficeCredential,
} from "../middleware/officeCredential";
import { HardwarePayments } from "./hardwarePayments";
export function hardwarePaymentService() {
  return new HardwarePayments({
    secret: process.env.HARDWARE_PAYSTACK_SECRET_KEY || "",
    callback: process.env.HARDWARE_PAYSTACK_CALLBACK_URL || "",
    provider: paystack,
    rpc: async (name, args) => {
      const r = await supabaseAdmin.rpc(name, args);
      if (r.error) throw Error("payment_storage_unavailable");
      return r.data;
    },
    get: async (reference) => {
      const r = await supabaseAdmin
        .from("hardware_payment_attempts")
        .select("*")
        .eq("reference", reference)
        .maybeSingle();
      if (r.error) throw Error("payment_storage_unavailable");
      return r.data;
    },
    due: async () => {
      const r = await supabaseAdmin
        .from("hardware_payment_attempts")
        .select("reference")
        .in("state", ["initializing", "pending", "uncertain", "verified"])
        .lte("next_attempt_at", new Date().toISOString())
        .order("next_attempt_at")
        .limit(100);
      if (r.error) throw Error("payment_storage_unavailable");
      return r.data || [];
    },
    office: async (proof) => {
      const base = process.env.OFFICE_HARDWARE_PAYMENT_CONFIRM_URL || "",
        key = process.env.OFFICE_HARDWARE_PAYMENT_CONFIRM_KEY || "";
      const u = new URL(base);
      if (u.protocol !== "https:" || key.length < 32)
        throw Error("office_confirmation_unconfigured");
      const r = await fetch(u, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key },
        body: JSON.stringify(proof),
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw Error("office_confirmation_unavailable");
      return r.json();
    },
  });
}
export function hardwareWebhookHandler(
  factory = hardwarePaymentService,
): express.RequestHandler {
  return async (req, res) => {
    // Ingress/recovery are independent of new-payment initialization switch.
    if (process.env.HARDWARE_PAYMENT_PROCESSING_ENABLED !== "true") {
      res.sendStatus(503);
      return;
    }
    try {
      await factory().webhook(req.body, req.headers["x-paystack-signature"]);
      res.sendStatus(200);
    } catch (e) {
      res.sendStatus((e as Error).message === "invalid_signature" ? 401 : 503);
    }
  };
}
export const hardwareWebhook = hardwareWebhookHandler();
export function hardwareRoutes(factory = hardwarePaymentService) {
  const hardwarePaymentRouter = express.Router();
  hardwarePaymentRouter.use((req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    res.set("X-Content-Type-Options", "nosniff");
    const key = process.env.HARDWARE_OFFICE_API_KEY || "";
    if (
      key.length < 32 ||
      !officeCredentialTimingSafeEqual(resolveOfficeCredential(req), key)
    ) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  });
  hardwarePaymentRouter.post("/initialize", async (req, res) => {
    if (process.env.HARDWARE_PAYMENT_INITIALIZATION_ENABLED !== "true") {
      res.status(503).json({ error: "payments_disabled" });
      return;
    }
    try {
      res.json(await factory().initialize(req.body));
    } catch (e) {
      const invalid = (e as Error).message === "invalid_payment_authorization";
      res.status(invalid ? 400 : 503).json({
        error: invalid
          ? "invalid_payment_authorization"
          : "payment_unavailable",
      });
    }
  });
  hardwarePaymentRouter.post("/reconcile", async (req, res) => {
    if (process.env.HARDWARE_PAYMENT_PROCESSING_ENABLED !== "true") {
      res.sendStatus(503);
      return;
    }
    try {
      if (req.body.reference) await factory().reconcile(req.body.reference);
      else await factory().sweep();
      res.json({ accepted: true });
    } catch {
      res.status(503).json({ error: "reconciliation_unavailable" });
    }
  });

  return hardwarePaymentRouter;
}
export const hardwarePaymentRouter = hardwareRoutes();
