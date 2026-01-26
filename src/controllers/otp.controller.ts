// src/controllers/otp.controller.ts
import { Request, Response } from "express";
import {
  canSendOtp,
  generateOtpCode,
  saveOtp,
  verifyOtp,
  type OtpPurpose,
} from "../services/otpService";
import { sendOtpEmail } from "../services/mailer/resendMailer";
import { confirmSupabaseEmailByEmail } from "../services/userVerificationService";

const PURPOSES = new Set<OtpPurpose>(["signup", "login"]);

function normalizePurpose(p: any): OtpPurpose {
  const v = (p || "signup").toString().toLowerCase();
  return PURPOSES.has(v as OtpPurpose) ? (v as OtpPurpose) : "signup";
}

export async function sendOtp(req: Request, res: Response) {
  try {
    const email = (req.body?.email || "").toString().trim().toLowerCase();
    const purpose = normalizePurpose(req.body?.purpose);

    if (!email || !email.includes("@")) {
      return res.status(400).json({ ok: false, message: "Valid email required" });
    }

    const allowed = await canSendOtp(email, purpose);
    if (!allowed) {
      return res.status(429).json({
        ok: false,
        message: "Too many requests. Please wait a bit and try again.",
      });
    }

    const code = generateOtpCode(6);
    await saveOtp(email, purpose, code);

    await sendOtpEmail({ to: email, code, purpose });

    return res.json({ ok: true, message: "OTP sent" });
  } catch (err: any) {
    console.error("sendOtp error:", err?.message || err);
    return res.status(500).json({ ok: false, message: "Failed to send OTP" });
  }
}

export async function verifyOtpHandler(req: Request, res: Response) {
  try {
    const email = (req.body?.email || "").toString().trim().toLowerCase();
    const code = (req.body?.code || "").toString().trim();
    const purpose = normalizePurpose(req.body?.purpose);

    if (!email || !email.includes("@")) {
      return res.status(400).json({ ok: false, message: "Valid email required" });
    }
    if (!code || code.length < 4) {
      return res.status(400).json({ ok: false, message: "Valid code required" });
    }

    const result = await verifyOtp(email, purpose, code);
    if (!result.ok) {
      return res.status(401).json({ ok: false, message: `OTP ${result.reason}` });
    }

    // ✅ KEY NEXT STEP: if this is signup verification, confirm Supabase email
    // so both Facility app and Consumer app can rely on one truth (Supabase).
    if (purpose === "signup") {
      const confirmed = await confirmSupabaseEmailByEmail(email);
      if (!confirmed.ok) {
        // You can decide if you want to fail verification here or just warn.
        // I recommend failing so you never have "OTP ok but Supabase not confirmed".
        return res.status(404).json({
          ok: false,
          message: "OTP verified but Supabase user not found for this email",
        });
      }
    }

    return res.json({ ok: true, message: "OTP verified" });
  } catch (err: any) {
    console.error("verifyOtp error:", err?.message || err);
    return res.status(500).json({ ok: false, message: "Failed to verify OTP" });
  }
}
