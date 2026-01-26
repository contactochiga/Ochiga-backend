// src/services/emailService.ts
import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MAIL_FROM = process.env.MAIL_FROM; // e.g. "Ochiga <no-reply@ochiga.com.ng>"

if (!RESEND_API_KEY) {
  console.warn("⚠️ RESEND_API_KEY not set — email sending will fail");
}
if (!MAIL_FROM) {
  console.warn("⚠️ MAIL_FROM not set — email sending will fail");
}

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

export const emailService = {
  async sendEmail(params: { to: string; subject: string; html: string; text?: string }) {
    if (!resend) throw new Error("Email not configured: missing RESEND_API_KEY");
    if (!MAIL_FROM) throw new Error("Email not configured: missing MAIL_FROM");

    await resend.emails.send({
      from: MAIL_FROM,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });
  },
};
