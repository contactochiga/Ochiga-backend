import express from "express";
import { sendSignupOtp, verifySignupOtp } from "../controllers/authOtpController";

const router = express.Router();

// POST /auth/otp/send  { email }
router.post("/otp/send", sendSignupOtp);

// POST /auth/otp/verify { email, code }
router.post("/otp/verify", verifySignupOtp);

export default router;
