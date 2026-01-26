// src/controllers/otp.controller.ts
import { Request, Response } from "express";
import {
  canSendOtp,
  generateOtpCode,
  saveOtp,
  verifyOtpCode,
} from "../services/otpService";
import { sendEmail } from "../services/emailService";

const PURPOSES = new Set(["signup", "login"]);

function normalizePurpose(p: any) {
  const v = (p || "signup").toString().toLowerCase();
  return PURPOSES.has(v) ? (v as "signup" | "login") : "signup";
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

    const from = process.env.EMAIL_FROM || "no-reply@ochiga.com.ng";
    const subject =
      purpose === "signup" ? "Verify your Oyi account" : "Your login code";

    const html = `
      <div style="font-family: Inter, Arial, sans-serif; line-height:1.5; color:#111;">
        <h2 style="margin:0 0 8px;">Your verification code</h2>
        <p style="margin:0 0 16px;">Use this code to continue:</p>
        <div style="font-size:28px; font-weight:700; letter-spacing:6px; padding:14px 16px; background:#f3f4f6; border-radius:12px; display:inline-block;">
          ${code}
        </div>
        <p style="margin:16px 0 0; color:#666; font-size:12px;">
          This code expires in 10 minutes.
        </p>
      </div>
    `;

    await sendEmail({ to: email, from, subject, html, text: `Your code is ${code}` });

    return res.json({ ok: true, message: "OTP sent" });
  } catch (err: any) {
    console.error("sendOtp error:", err?.message || err);
    return res.status(500).json({ ok: false, message: "Failed to send OTP" });
  }
}

export async function verifyOtp(req: Request, res: Response) {
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

    const ok = await verifyOtpCode(email, purpose, code);

    if (!ok) {
      return res.status(401).json({ ok: false, message: "Invalid or expired code" });
    }

    return res.json({ ok: true, message: "OTP verified" });
  } catch (err: any) {
    console.error("verifyOtp error:", err?.message || err);
    return res.status(500).json({ ok: false, message: "Failed to verify OTP" });
  }
}
