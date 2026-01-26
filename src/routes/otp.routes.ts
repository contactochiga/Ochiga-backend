// src/routes/otp.routes.ts
import { Router } from "express";
import { sendOtp, verifyOtp } from "../controllers/otp.controller";

const router = Router();

/**
 * POST /otp/send
 * body: { email: string, purpose?: "signup" | "login" }
 */
router.post("/send", sendOtp);

/**
 * POST /otp/verify
 * body: { email: string, code: string, purpose?: "signup" | "login" }
 */
router.post("/verify", verifyOtp);

export default router;
