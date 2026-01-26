// src/services/mailer/resendMailer.ts
import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY;

// This must be a verified domain in Resend (you already verified ochiga.com.ng)
// Example: "Oyi OS <no-reply@ochiga.com.ng>"
const OTP_FROM = process.env.OTP_FROM || "Ochiga <no-reply@ochiga.com.ng>";

if (!RESEND_API_KEY) {
  console.warn("⚠️ Missing env var: RESEND_API_KEY (OTP emails will fail)");
}

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

export type OtpPurpose = "signup" | "login" | "password_reset";

function purposeLabel(purpose: OtpPurpose) {
  if (purpose === "signup") return "Verify your email";
  if (purpose === "login") return "Login verification";
  return "Reset your password";
}

export async function sendOtpEmail(to: string, code: string, purpose: OtpPurpose) {
  if (!resend) throw new Error("RESEND_API_KEY not configured");

  const subject = `${purposeLabel(purpose)} · ${code}`;

  const html = `
  <div style="font-family: Arial, sans-serif; line-height:1.5; color:#111;">
    <h2 style="margin:0 0 12px 0;">${purposeLabel(purpose)}</h2>
    <p style="margin:0 0 12px 0;">Your one-time code is:</p>
    <div style="
      font-size:28px;
      letter-spacing:6px;
      font-weight:700;
      padding:14px 16px;
      border-radius:12px;
      background:#0b1220;
      color:#fff;
      display:inline-block;">
      ${code}
    </div>
    <p style="margin:16px 0 0 0; color:#444;">
      This code expires in 10 minutes. If you didn’t request it, ignore this email.
    </p>
  </div>`;

  const { error } = await resend.emails.send({
    from: OTP_FROM,
    to,
    subject,
    html,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }

  return true;
}
