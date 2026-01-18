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
import facilityRoutes from "./routes/facility.routes"; // ✅ FACILITY MGMT

const app = express();

// -------------------------------
// SECURITY
// -------------------------------
app.use(helmet());

// -------------------------------
// ⭐ CORS (VERCEL + CODESPACES SAFE)
// -------------------------------
const ALLOWED_ORIGINS = new Set<string>([
  "http://localhost:3000",
  "http://localhost:3001",

  // Main consumer app (prod domains)
  "https://oyi.com",
  "https://www.oyi.com",

  // Facility management app (prod custom domain)
  "https://facility.oyi.com",

  // ✅ Vercel production domain (YOU MUST INCLUDE THIS)
  "https://facility-oyi.vercel.app",

  // (Optional) your render backend (not necessary, but harmless)
  "https://oyi-os.onrender.com",
]);

function isAllowedOrigin(origin?: string | null) {
  if (!origin) return true; // allow server-to-server / Postman / curl

  // Exact allowlist
  if (ALLOWED_ORIGINS.has(origin)) return true;

  // ✅ Allow Vercel Preview URLs for this project
  // e.g. https://facility-oyi-abc123.vercel.app
  if (/^https:\/\/facility-oyi-[a-z0-9-]+\.vercel\.app$/i.test(origin)) return true;

  // ✅ Allow GitHub Codespaces / github.dev
  // typical: https://<something>-3001.app.github.dev
  if (/^https:\/\/.*\.app\.github\.dev$/i.test(origin)) return true;
  if (/^https:\/\/.*\.github\.dev$/i.test(origin)) return true;

  return false;
}

app.use(
  cors({
    origin: (origin, cb) => {
      if (isAllowedOrigin(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ✅ handle preflight explicitly (important for some browsers/proxies)
app.options("*", cors());

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

app.use("/estates", estatesRoutes);
app.use("/residents", residentsRoutes);
app.use("/devices", devicesRoutes);
app.use("/visitors", visitorRoutes);

app.use("/facility", facilityRoutes); // ✅ FACILITY DASHBOARD API
app.use("/signals", signalRoutes); // ✅ CONTROL PLANE ENTRY

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
