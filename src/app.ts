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
import aiRoutes from "./routes/aiRoutes"; // ✅ AI ROUTES

const app = express();

// -------------------------------
// SECURITY
// -------------------------------
app.use(helmet());

// -------------------------------
// ⭐ CORS (PRODUCTION-READY + VERCEL-SAFE)
// -------------------------------
const allowList = new Set([
  "http://localhost:3000",
  "http://localhost:3001",

  // Main consumer app
  "https://oyi.com",
  "https://www.oyi.com",

  // Facility management custom domain
  "https://facility.oyi.com",

  // Render backend (safe to include)
  "https://oyi-os.onrender.com",
]);

function isAllowedOrigin(origin: string) {
  // ✅ Allow explicit allow-list
  if (allowList.has(origin)) return true;

  // ✅ Allow all Vercel deployments (preview + production)
  // e.g. https://facility-oyi-xxxxx.vercel.app
  if (origin.endsWith(".vercel.app")) return true;

  // ✅ Allow GitHub Codespaces + VSCode web
  if (origin.endsWith(".github.dev")) return true;

  return false;
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server / health checks / curl / Postman (no Origin header)
      if (!origin) return callback(null, true);

      if (isAllowedOrigin(origin)) return callback(null, true);

      console.error("❌ CORS blocked:", origin);
      return callback(new Error("CORS blocked"));
    },
    credentials: true,

    // ✅ Make preflight fast + stable on Vercel browsers
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

app.use("/estates", estatesRoutes);
app.use("/residents", residentsRoutes);
app.use("/devices", devicesRoutes);

app.use("/ai", aiRoutes); // ✅ AI CHAT / NLU ROUTES

app.use("/visitors", visitorRoutes);

app.use("/facility", facilityRoutes); // ✅ FACILITY DASHBOARD + MGMT API
app.use("/signals", signalRoutes);    // ✅ CONTROL PLANE ENTRY

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
