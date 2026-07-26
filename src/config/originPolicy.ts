import type { CorsOptions } from "cors";

const staticAllowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:8100",
  "http://localhost",
  "capacitor://localhost",
  "ionic://localhost",
  "https://getoyi.com",
  "https://www.getoyi.com",
  "https://facility.getoyi.com",
  "https://app.getoyi.com",
  "https://oyi.com",
  "https://www.oyi.com",
  "https://facility.oyi.com",
  "https://oyi-os.onrender.com",
];

function envOrigins() {
  return [
    process.env.PUBLIC_APP_URL,
    process.env.APP_URL,
    process.env.FRONTEND_URL,
    process.env.CONSUMER_APP_URL,
    process.env.FACILITY_APP_URL,
    process.env.OFFICE_APP_URL,
    process.env.SOCKET_ALLOWED_ORIGINS,
    process.env.CORS_ALLOWED_ORIGINS,
  ]
    .flatMap((value) => String(value || "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

export const allowList = new Set([...staticAllowedOrigins, ...envOrigins()]);

export const allowedHeaders = [
  "Content-Type",
  "Authorization",
  "x-api-key",
  "x-otp-token",
  "X-Requested-With",
  "X-Ochiga-Surface",
  "X-Oyi-Contract-Version",
  "X-Oyi-Runtime",
  "X-Oyi-Estate-Id",
  "X-Oyi-Home-Id",
  "X-Oyi-Context-Key",
  "Idempotency-Key",
  "X-Idempotency-Key",
  "X-IR-Tap-Sequence",
  "X-Client-Tap-Timestamp",
  "Accept",
  "Origin",
];

export function isAllowedOrigin(origin: string) {
  if (!origin) return true;
  if (allowList.has(origin)) return true;
  if (origin.startsWith("capacitor://")) return true;
  if (origin.startsWith("ionic://")) return true;
  if (origin.endsWith(".vercel.app")) return true;
  if (origin.endsWith(".github.dev")) return true;
  return false;
}

export const httpCorsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || isAllowedOrigin(origin)) return callback(null, true);
    return callback(new Error("CORS blocked"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders,
  maxAge: 86400,
  optionsSuccessStatus: 204,
};

export const socketCorsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin || isAllowedOrigin(origin)) return callback(null, true);
    return callback(new Error("CORS blocked"));
  },
  credentials: true,
};
