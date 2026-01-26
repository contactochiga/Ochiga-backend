// src/controllers/otp.controller.ts
import { Request, Response } from "express";
import { z } from "zod";
import { otpService } from "../services/otpService";

const RequestSchema = z.object({
  email: z.string().email(),
  purpose: z.string().optional().default("verify"),
});

const VerifySchema = z.object({
  email: z.string().email(),
  code: z.string().min(4).max(8),
  purpose: z.string().optional().default("verify"),
});

export async function requestOtp(req: Request, res: Response) {
  try {
    const { email, purpose } = RequestSchema.parse(req.body);

    await otpService.sendOtp(email, purpose);

    return res.status(200).json({
      ok: true,
      message: "OTP sent",
    });
  } catch (e: any) {
    return res.status(400).json({
      ok: false,
      error: e?.message || "Failed to send OTP",
    });
  }
}

export async function verifyOtp(req: Request, res: Response) {
  try {
    const { email, code, purpose } = VerifySchema.parse(req.body);

    const ok = await otpService.verifyOtp(email, code, purpose);

    if (!ok) {
      return res.status(400).json({
        ok: false,
        error: "Invalid or expired OTP",
      });
    }

    return res.status(200).json({
      ok: true,
      verified: true,
    });
  } catch (e: any) {
    return res.status(400).json({
      ok: false,
      error: e?.message || "OTP verification failed",
    });
  }
}
