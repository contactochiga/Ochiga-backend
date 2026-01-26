// src/services/otpService.ts
import { redis } from "../config/redis";
import { sendEmail } from "./emailService";

const OTP_TTL_SECONDS = Number(process.env.OTP_TTL_SECONDS || 600); // 10 mins default

function otpKey(email: string) {
  return `otp:signup:${email.toLowerCase()}`;
}

function generateOtp(len = 6) {
  let out = "";
  for (let i = 0; i < len; i++) out += Math.floor(Math.random() * 10);
  return out;
}

export const otpService = {
  async sendSignupOtp(email: string) {
    const code = generateOtp(6);

    // store in redis with TTL
    await redis.set(otpKey(email), code, { EX: OTP_TTL_SECONDS });

    const subject = "Your Ochiga verification code";
    const html = `
      <div style="font-family: Inter, Arial, sans-serif; line-height:1.6;">
        <h2 style="margin:0 0 8px;">Verify your email</h2>
        <p style="margin:0 0 16px;">Use this code to complete your signup:</p>
        <div style="font-size:28px; font-weight:700; letter-spacing:6px; padding:14px 16px; background:#0b0f19; border-radius:12px; display:inline-block; color:#fff;">
          ${code}
        </div>
        <p style="margin:16px 0 0; color:#6b7280; font-size:12px;">
          This code expires in ${Math.ceil(OTP_TTL_SECONDS / 60)} minutes.
        </p>
      </div>
    `;

    await sendEmail({
      to: email,
      subject,
      html,
    });
  },

  async verifyOtp(email: string, code: string) {
    const saved = await redis.get(otpKey(email));
    if (!saved) return false;

    const ok = saved === code;
    if (ok) {
      await redis.del(otpKey(email)); // one-time use
    }
    return ok;
  },
};
