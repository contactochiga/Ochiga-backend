// src/routes/otp.routes.ts
import { Router } from "express";
import { sendOtp, verifyOtpHandler } from "../controllers/otp.controller";

const router = Router();

router.post("/send", sendOtp);
router.post("/verify", verifyOtpHandler);

export default router;
