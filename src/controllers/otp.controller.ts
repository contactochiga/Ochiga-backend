// src/controllers/otp.controller.ts
import { Request, Response } from "express";
import { z } from "zod";
import { otpService } from "../services/otpService";

const requestSchema = z.object({
  email: z.string().email(),
});

const verifySchema = z.object({
  email: z.string().email(),
  code: z.string().min(4).max(10),
});

export async function requestOtp(req: Request, res: Response) {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ status: "error", message: "Invalid payload" });
  }

  const { email } = parsed.data;

  try {
    await otpService.sendSignupOtp(email);

    return res.json({
      status: "ok",
      message: "OTP sent",
    });
  } catch (e: any) {
    console.error("requestOtp error:", e?.message || e);
    return res.status(500).json({
      status: "error",
      message: "Failed to send OTP",
    });
  }
}

export async function verifyOtp(req: Request, res: Response) {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ status: "error", message: "Invalid payload" });
  }

  const { email, code } = parsed.data;

  try {
    const ok = await otpService.verifyOtp(email, code);

    if (!ok) {
      return res.status(401).json({
        status: "error",
        message: "Invalid or expired OTP",
      });
    }

    return res.json({
      status: "ok",
      message: "Email verified",
    });
  } catch (e: any) {
    console.error("verifyOtp error:", e?.message || e);
    return res.status(500).json({
      status: "error",
      message: "Failed to verify OTP",
    });
  }
}
