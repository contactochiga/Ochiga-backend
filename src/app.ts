// src/app.ts
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

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

// ✅ NEW: OTP routes (email verification)
import otpRoutes from "./routes/otp.routes";

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
  "http://localhost:3000",
  "http://localhost:3001",

  "https://oyi.com",
  "https://www.oyi.com",
  "https://facility.oyi.com",

  "https://oyi-os.onrender.com",
]);

function isAllowedOrigin(origin: string) {
  if (allowList.has(origin)) return true;
  if (origin.endsWith(".vercel.app")) return true;
  if (origin.endsWith(".github.dev")) return true;
  return false;
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (isAllowedOrigin(origin)) return callback(null, true);
      console.error("❌ CORS blocked:", origin);
      return callback(new Error("CORS blocked"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204,
  })
);

// -------------------------------
// BODY PARSING & LOGGING
// -------------------------------
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
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

// ✅ NEW OTP endpoints (doesn't touch existing auth)
app.use("/auth/otp", otpRoutes);

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
