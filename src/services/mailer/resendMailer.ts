import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendOtpEmail(params: { to: string; code: string }) {
  const from = process.env.MAIL_FROM || "Oyi <no-reply@ochiga.com.ng>";
  const replyTo = process.env.MAIL_REPLY_TO || undefined;

  const { to, code } = params;

  const ttlSeconds = Number(process.env.OTP_TTL_SECONDS || 600);
  const ttlMins = Math.max(1, Math.round(ttlSeconds / 60));

  const subject = `Your Oyi verification code: ${code}`;

  const html = `
  <div style="font-family: ui-sans-serif,system-ui,-apple-system; line-height:1.5; color:#111;">
    <h2 style="margin:0 0 12px;">Verify your email</h2>
    <p style="margin:0 0 14px;">Use this code to verify your account:</p>
    <div style="font-size:28px; font-weight:700; letter-spacing:6px; padding:14px 16px; background:#f4f4f5; border-radius:12px; display:inline-block;">
      ${code}
    </div>
    <p style="margin:14px 0 0; color:#666; font-size:13px;">
      This code expires in ${ttlMins} minutes.
    </p>
  </div>
  `;

  await resend.emails.send({
    from,
    to,
    subject,
    html,
    replyTo: replyTo ? [replyTo] : undefined,
  });
}
