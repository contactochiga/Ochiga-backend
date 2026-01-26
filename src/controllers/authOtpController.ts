import { Request, Response } from "express";
import { sendOtpEmail } from "../services/mailer/resendMailer";
import { canSendOtp, generateOtpCode, saveOtp, verifyOtp } from "../services/otpService";

// ✅ Use your existing user store logic.
// Here I assume you already create users somewhere.
// We'll only handle OTP send/verify and then call "markVerified".

async function markUserVerified(email: string) {
  // TODO: implement with your DB/Supabase:
  // UPDATE users SET email_verified=true WHERE email=...
  return true;
}

export async function sendSignupOtp(req: Request, res: Response) {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "email is required" });

    const allowed = await canSendOtp(email);
    if (!allowed) return res.status(429).json({ error: "Please wait and try again" });

    const code = generateOtpCode();
    await saveOtp(email, code);

    await sendOtpEmail({ to: email, code });

    return res.status(200).json({ message: "OTP sent" });
  } catch (err: any) {
    console.error("sendSignupOtp error:", err);
    return res.status(500).json({ error: err?.message || "Failed to send OTP" });
  }
}

export async function verifySignupOtp(req: Request, res: Response) {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const code = String(req.body.code || "").trim();

    if (!email || !code) {
      return res.status(400).json({ error: "email and code are required" });
    }

    const result = await verifyOtp(email, code);
    if (!result.ok) {
      return res.status(400).json({ error: `OTP ${result.reason}` });
    }

    await markUserVerified(email);

    // ✅ If your system issues JWT/cookies at verification, do it here.
    // Otherwise just return OK and let them login normally.
    return res.status(200).json({ message: "Email verified" });
  } catch (err: any) {
    console.error("verifySignupOtp error:", err);
    return res.status(500).json({ error: err?.message || "Verification failed" });
  }
}
