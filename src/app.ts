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

const app = express();

// ✅ important for Render/Vercel reverse proxy (cookies/https)
app.set("trust proxy", 1);

// -------------------------------
// SECURITY
// -------------------------------
app.use(helmet());

// -------------------------------
// ⭐ CORS (FIXED for Capacitor/iOS)
// -------------------------------
const allowList = new Set([
  // Web local dev
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost",

  // ✅ Capacitor / Ionic native WebView origins
  "capacitor://localhost",
  "ionic://localhost",

  // Production domains
  "https://oyi.com",
  "https://www.oyi.com",
  "https://facility.oyi.com",

  "https://oyi-os.onrender.com",
]);

function isAllowedOrigin(origin: string) {
  if (allowList.has(origin)) return true;

  // ✅ allow vercel previews + prod apps
  if (origin.endsWith(".vercel.app")) return true;

  // ✅ allow github codespaces/dev
  if (origin.endsWith(".github.dev")) return true;

  return false;
}

const corsMiddleware: express.RequestHandler = cors({
  origin: (origin, callback) => {
    // ✅ Native apps / curl / server-to-server can have NO origin
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
    "x-otp-token",
    "X-Requested-With",
  ],
  optionsSuccessStatus: 204,
});

app.use(corsMiddleware);
app.options("*", corsMiddleware);

// -------------------------------
// BODY PARSING & LOGGING
// -------------------------------
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); // ✅ required for req.cookies
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

app.use("/invites", invitesRoutes); // ✅ NEW

app.use("/estates", estatesRoutes);
app.use("/residents", residentsRoutes);
app.use("/devices", devicesRoutes);

app.use("/ai", aiRoutes);
app.use("/visitors", visitorRoutes);

app.use("/community", communityRoutes);
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
