// src/services/mailer/resendMailer.ts
import { Resend } from "resend";
import type { OtpPurpose } from "../otpService";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || "no-reply@ochiga.com.ng";

if (!RESEND_API_KEY) {
  console.warn("⚠️ Missing RESEND_API_KEY (emails will fail until set).");
}

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

type SendWithResendArgs = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  attachments?: Array<{ filename: string; content: string }>;
};

export async function sendWithResend(args: SendWithResendArgs) {
  if (!resend) throw new Error("RESEND_API_KEY not set");

  return resend.emails.send({
    from: args.from || EMAIL_FROM,
    to: args.to,
    subject: args.subject,
    html: args.html,
    text: args.text,
    attachments: args.attachments,
  });
}

export async function sendOtpEmail(args: {
  to: string;
  code: string;
  purpose: OtpPurpose;
}) {
  const subject =
    args.purpose === "signup"
      ? "Verify your Ochiga account"
      : args.purpose === "password_reset"
        ? "Reset your Ochiga password"
        : "Your login code";

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; line-height:1.5; color:#111;">
      <h2 style="margin:0 0 8px;">${args.purpose === "password_reset" ? "Your password reset code" : "Your verification code"}</h2>
      <p style="margin:0 0 16px;">Use this code to continue:</p>
      <div style="font-size:28px; font-weight:700; letter-spacing:6px; padding:14px 16px; background:#f3f4f6; border-radius:12px; display:inline-block;">
        ${args.code}
      </div>
      <p style="margin:16px 0 0; color:#666; font-size:12px;">
        This code expires in 10 minutes.
      </p>
    </div>
  `;

  return sendWithResend({
    to: args.to,
    subject,
    html,
    text: `${args.purpose === "password_reset" ? "Your password reset code" : "Your code"} is ${args.code}`,
  });
}
