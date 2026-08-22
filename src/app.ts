// src/app.ts
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { healthHandler, metricsHandler, requestContextMiddleware, requestLoggingMiddleware, runtimeHealthHandler, versionHandler } from "./observability/http";
import { aiRateLimit, authRateLimit, runtimeRateLimit, signalIngressRateLimit } from "./middleware/rateLimit";
import { httpCorsOptions } from "./config/originPolicy";
import { attachUser } from "./middleware/auth";
import { requireInternalAccess } from "./middleware/internalGuard";

// -------------------------------
// ROUTES
// -------------------------------
import authRoutes from "./routes/auth";
import estatesRoutes from "./routes/estates";
import residentsRoutes from "./routes/residents";
import devicesRoutes from "./routes/devices";
import onboardingRoutes from "./routes/onboarding";
import inviteActivationRoutes from "./routes/inviteActivation";
import visitorRoutes from "./routes/visitors";
import signalRoutes from "./routes/signals";
import facilityRoutes from "./routes/facility.routes";
import aiRoutes from "./routes/aiRoutes";
import intelligenceRoutes from "./routes/intelligenceRoutes";
import oyiRoutes from "./routes/oyiRoutes";
import watchRoutes from "./routes/watchRoutes";
import activityRoutes from "./routes/activity";
import scenesRoutes from "./routes/scenes";
import automationsRoutes from "./routes/automations";
import homeMembersRoutes from "./routes/homeMembers";
import spacesTwinRoutes from "./routes/spacesTwin";
import integrationsRoutes from "./routes/integrations";

import communityRoutes from "./routes/community";
import walletRoutes from "./routes/wallets";
import servicesRoutes from "./routes/services";
import roomsRoutes from "./routes/rooms";
import geoRoutes from "./routes/geo";
import proximityRoutes from "./routes/proximityRoutes";
import officeExportRoutes from "./routes/officeExport";
import twilioWebhooksRoutes from "./routes/twilioWebhooks";
import communicationsRoutes from "./routes/communications";

// ✅ OTP routes (email verification)
import otpRoutes from "./routes/otp.routes";

// ✅ Invites routes
import invitesRoutes from "./routes/invites.routes";

// ✅ Me routes (context for consumer UI)
import meRoutes from "./routes/me.routes";

// ✅ Notifications routes (GET /notifications, POST /notifications/read/:id)
import notificationsRoutes from "./routes/notifications";
import pushRoutes from "./routes/push";

// ✅ Maintenance routes (consumer)
import maintenanceRoutes from "./routes/maintenance.routes";
import messagesRoutes from "./routes/messages";
import superAdminRoutes from "./routes/superAdmin";

// ✅ Facility maintenance routes
import facilityMaintenanceRoutes from "./routes/facilityMaintenanceRoutes";

// ✅ Facility visitors routes
import facilityVisitorsRoutes from "./routes/facilityVisitorsRoutes";

// ✅ Cameras routes (scan/bind/stream)
import camerasRoutes from "./routes/cameras";

// ✅ Edge Discovery (agent push + UI pull)
import { edgeDiscoveryRouter } from "./routes/edgeDiscovery";

// ✅ IMPORTANT: Paystack webhook must use RAW body
import * as WalletCtrl from "./controllers/walletController";

const app = express();

// ✅ important for Render/Vercel reverse proxy (cookies/https)
app.set("trust proxy", 1);

// -------------------------------
// SECURITY
// -------------------------------
// ✅ FIX: allow HLS (m3u8/ts) to be loaded cross-origin (facility.getoyi.com -> oyi-os.onrender.com)
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// -------------------------------
// ⭐ CORS
// -------------------------------
const corsMiddleware = cors(httpCorsOptions);

app.use(corsMiddleware);
app.options("*", corsMiddleware);

// ----------------------------------------------------
// ✅ PAYSTACK WEBHOOK (RAW BODY) — MUST COME BEFORE JSON
// ----------------------------------------------------
app.post(
  "/wallets/webhook",
  express.raw({ type: "application/json" }),
  (req, _res, next) => {
    (req as any).rawBody = req.body;

    try {
      req.body = JSON.parse((req.body as Buffer).toString("utf8"));
    } catch {
      // ignore
    }
    next();
  },
  WalletCtrl.handleWebhook
);

// -------------------------------
// BODY PARSING & LOGGING
// -------------------------------
app.use(requestContextMiddleware);
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(requestLoggingMiddleware);

// -------------------------------
// SECURITY: response sanitizer
// Scrubs internal error detail (Postgres messages, relation names, stack
// traces) from JSON error responses so legacy controllers that still do
// `res.status(500).json({ error: error.message })` do not leak internals.
// -------------------------------
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  const originalJson = res.json.bind(res);
  (res as any).json = function sanitizeJson(body: any) {
    if (body && typeof body === "object" && Number(res.statusCode) >= 500) {
      const errText = String(body?.error || body?.message || "");
      const looksInternal = /relation "|column "|schema cache|could not find|does not exist|syntax error at|failed to fetch|ECONNREFUSED|invalid input syntax|duplicate key|violates foreign key|violates not-null|JWT|secret|stack|at \/|node:internal/i.test(errText);
      if (looksInternal) {
        const sanitized = { ...body, error: "An unexpected error occurred. Please try again.", code: body?.code || "internal_error" };
        if ("message" in sanitized) sanitized.message = sanitized.error;
        return originalJson(sanitized);
      }
    }
    return originalJson(body);
  } as any;
  next();
});

// -------------------------------
// ROOT & HEALTH
// -------------------------------
app.get("/", (_req, res) => {
  res.send("🔥 Ochiga Backend API is running");
});

app.get("/health", (_req, res) => {
  return healthHandler(_req, res);
});

app.get("/version", versionHandler);
app.get("/health/runtime", attachUser, requireInternalAccess, runtimeHealthHandler);
app.get("/metrics", attachUser, requireInternalAccess, metricsHandler);

// -------------------------------
// ROUTE MOUNTING
// -------------------------------
app.use("/auth", authRateLimit, authRoutes);
app.use("/auth/onboard", authRateLimit, onboardingRoutes);
app.use("/auth/invites", authRateLimit, inviteActivationRoutes);
app.use("/auth/otp", authRateLimit, otpRoutes);

app.use("/invites", invitesRoutes);

// ✅ consumer context endpoint
app.use("/me", meRoutes);

// ✅ notifications
app.use("/notifications", notificationsRoutes);
app.use("/push", pushRoutes);

app.use("/estates", estatesRoutes);
app.use("/residents", residentsRoutes);
app.use("/devices", devicesRoutes);

app.use("/ai", aiRateLimit, aiRoutes);
app.use("/oyi", runtimeRateLimit, oyiRoutes);
app.use("/intelligence", intelligenceRoutes);
app.use("/watch", watchRoutes);
app.use("/activity", activityRoutes);
app.use("/api/activity", activityRoutes);
app.use("/scenes", scenesRoutes);
app.use("/api/scenes", scenesRoutes);
app.use("/automations", automationsRoutes);
app.use("/api/automations", automationsRoutes);
app.use("/home/members", homeMembersRoutes);
app.use("/spaces", spacesTwinRoutes);
app.use("/integrations", integrationsRoutes);

// ✅ consumer visitors
app.use("/visitors", visitorRoutes);

// ✅ consumer maintenance
app.use("/maintenance", maintenanceRoutes);
app.use("/messages", messagesRoutes);
app.use("/super-admin", superAdminRoutes);

// ✅ facility maintenance
app.use("/facility/maintenance", facilityMaintenanceRoutes);

// ✅ facility visitors
app.use("/facility/visitors", facilityVisitorsRoutes);

app.use("/community", communityRoutes);
app.use("/api/community", communityRoutes);

// ✅ wallet routes
app.use("/wallets", walletRoutes);
app.use("/services", servicesRoutes);

app.use("/rooms", roomsRoutes);
app.use("/geo", geoRoutes);
app.use("/proximity", proximityRoutes);
app.use("/api/proximity", proximityRoutes);

app.use("/facility", facilityRoutes);
app.use("/signals", signalIngressRateLimit, signalRoutes);
app.use("/office", officeExportRoutes);
app.use("/communications", communicationsRoutes);
app.use("/webhooks/twilio", twilioWebhooksRoutes);

// ✅ EXTRA SAFE: force CORP on camera endpoints (m3u8 + ts)
app.use("/cameras", (_req, res, next) => {
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  next();
});

// ✅ cameras (scan/bind/HLS)
app.use("/cameras", camerasRoutes);

// ✅ edge discovery (agent push + UI pull)
app.use(edgeDiscoveryRouter);

// -------------------------------
// 404 HANDLER
// -------------------------------
app.use((req, res) => {
  res.status(404).json({
    status: "error",
    message: "Route not found",
    path: req.originalUrl,
  });
});

// -------------------------------
// SECURITY: centralized error handler
// Catches thrown/unhandled async errors so they never surface as a default
// Express HTML page or a raw stack trace. The response sanitizer above will
// scrub the body before it is sent.
// -------------------------------
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = Number(err?.statusCode || err?.status) || 500;
  res.status(status).json({ error: err?.message || "An unexpected error occurred.", code: err?.code || "internal_error" });
});

export default app;
