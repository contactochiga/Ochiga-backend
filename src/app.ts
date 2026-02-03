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
import visitorRoutes from "./routes/visitors";
import signalRoutes from "./routes/signals";
import facilityRoutes from "./routes/facility.routes";
import aiRoutes from "./routes/aiRoutes";

import communityRoutes from "./routes/community";
import walletRoutes from "./routes/wallets";
import roomsRoutes from "./routes/rooms";

// ✅ OTP routes (email verification)
import otpRoutes from "./routes/otp.routes";

// ✅ Invites routes
import invitesRoutes from "./routes/invites.routes";

// ✅ Me routes (context for consumer UI)
import meRoutes from "./routes/me.routes";

// ✅ Notifications routes (GET /notifications, POST /notifications/read/:id)
import notificationsRoutes from "./routes/notifications";

// ✅ Maintenance routes (consumer)
import maintenanceRoutes from "./routes/maintenance.routes";

// ✅ Facility maintenance routes
import facilityMaintenanceRoutes from "./routes/facilityMaintenanceRoutes";

// ✅ Facility visitors routes
import facilityVisitorsRoutes from "./routes/facilityVisitorsRoutes";

// ✅ IMPORTANT: Paystack webhook must use RAW body
import * as WalletCtrl from "./controllers/walletController";

const app = express();

// ✅ important for Render/Vercel reverse proxy (cookies/https)
app.set("trust proxy", 1);

// -------------------------------
// SECURITY
// -------------------------------
app.use(helmet());

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
  allowedHeaders: ["Content-Type", "Authorization", "x-otp-token", "X-Requested-With"],
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
    // keep raw body for signature verification
    (req as any).rawBody = req.body;

    // also parse JSON so controller can read req.body.event, etc.
    try {
      req.body = JSON.parse((req.body as Buffer).toString("utf8"));
    } catch {
      // if parse fails, controller will handle gracefully
    }
    next();
  },
  WalletCtrl.handleWebhook
);

// -------------------------------
// BODY PARSING & LOGGING
// -------------------------------
app.use(express.json({ limit: "2mb" }));
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
app.use("/auth/otp", otpRoutes);

app.use("/invites", invitesRoutes);

// ✅ consumer context endpoint
// GET /me/context -> { estate, home }
app.use("/me", meRoutes);

// ✅ notifications
app.use("/notifications", notificationsRoutes);

app.use("/estates", estatesRoutes);
app.use("/residents", residentsRoutes);
app.use("/devices", devicesRoutes);

app.use("/ai", aiRoutes);

// ✅ consumer visitors (resident creates visitor)
app.use("/visitors", visitorRoutes);

// ✅ consumer maintenance create/list (GET/POST /maintenance)
app.use("/maintenance", maintenanceRoutes);

// ✅ facility maintenance list/update
app.use("/facility/maintenance", facilityMaintenanceRoutes);

// ✅ facility visitors list/verify/update
app.use("/facility/visitors", facilityVisitorsRoutes);

app.use("/community", communityRoutes);

// ✅ wallet routes (init/debit/get wallet)
// NOTE: webhook is already mounted above with raw body
app.use("/wallets", walletRoutes);

app.use("/rooms", roomsRoutes);

app.use("/facility", facilityRoutes);
app.use("/signals", signalRoutes);

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
