// src/routes/otp.routes.ts
import express from "express";
import { requestOtp, verifyOtp } from "../controllers/otp.controller";

const router = express.Router();

/**
 * POST /auth/otp/request   { email, purpose? }
 * POST /auth/otp/verify    { email, code, purpose? }
 */
router.post("/request", requestOtp);
router.post("/verify", verifyOtp);

export default router;
