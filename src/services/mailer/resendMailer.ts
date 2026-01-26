// src/services/mailer/resendMailer.ts
import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY;

function requireEnv(name: string, value?: string) {
  if (!value) throw new Error(`❌ Missing env var: ${name}`);
  return value;
}

export async function sendWithResend(args: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}) {
  requireEnv("RESEND_API_KEY", RESEND_API_KEY);

  const resend = new Resend(RESEND_API_KEY);

  const from = args.from || process.env.EMAIL_FROM || "no-reply@ochiga.com.ng";

  const { data, error } = await resend.emails.send({
    from,
    to: args.to,
    subject: args.subject,
    html: args.html,
    text: args.text,
  });

  if (error) {
    throw new Error(error.message || "Resend send failed");
  }

  return data;
}
