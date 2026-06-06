// src/app.ts
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";

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
const allowList = new Set([
  // Web dev
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:8100",
  "http://localhost",

  // Capacitor / Ionic (iOS/Android WebView origins)
  "capacitor://localhost",
  "ionic://localhost",

  // ✅ PRODUCTION: GETOYI
  "https://getoyi.com",
  "https://www.getoyi.com",
  "https://facility.getoyi.com",
  "https://app.getoyi.com",
  // Older domains
  "https://oyi.com",
  "https://www.oyi.com",
  "https://facility.oyi.com",

  // Render backend
  "https://oyi-os.onrender.com",
]);

function isAllowedOrigin(origin: string) {
  if (!origin) return true;

  if (allowList.has(origin)) return true;

  if (origin.startsWith("capacitor://")) return true;
  if (origin.startsWith("ionic://")) return true;

  if (origin.endsWith(".vercel.app")) return true;
  if (origin.endsWith(".github.dev")) return true;

  return false;
}

const corsMiddleware = cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    if (isAllowedOrigin(origin)) return callback(null, true);

    console.error("❌ CORS blocked:", origin);
    return callback(new Error("CORS blocked"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "x-api-key",
    "x-otp-token",
    "X-Requested-With",
    "X-Ochiga-Surface",
    "X-Oyi-Contract-Version",
  ],
  optionsSuccessStatus: 204,
});

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
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan("dev"));

// -------------------------------
// ROOT & HEALTH
// -------------------------------
app.get("/", (_req, res) => {
  res.send("🔥 Ochiga Backend API is running");
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    message: "Ochiga Backend Connected 🔥",
    timestamp: new Date().toISOString(),
  });
});

// -------------------------------
// ROUTE MOUNTING
// -------------------------------
app.use("/auth", authRoutes);
app.use("/auth/onboard", onboardingRoutes);
app.use("/auth/invites", inviteActivationRoutes);
app.use("/auth/otp", otpRoutes);

app.use("/invites", invitesRoutes);

// ✅ consumer context endpoint
app.use("/me", meRoutes);

// ✅ notifications
app.use("/notifications", notificationsRoutes);
app.use("/push", pushRoutes);

app.use("/estates", estatesRoutes);
app.use("/residents", residentsRoutes);
app.use("/devices", devicesRoutes);

app.use("/ai", aiRoutes);
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
app.use("/signals", signalRoutes);
app.use("/office", officeExportRoutes);

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

export default app;
