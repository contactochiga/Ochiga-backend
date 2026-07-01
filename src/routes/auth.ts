// src/routes/auth.ts
import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { permissionsForRole } from "../core/foundation";
import { emitAuditEvent } from "../core/foundation/audit";
import { canSendOtp, generateOtpCode, saveOtp, verifyOtp } from "../services/otpService";
import { sendOtpEmail } from "../services/mailer/resendMailer";
import { consumePasswordResetToken, signPasswordResetToken, storePasswordResetToken } from "../services/passwordResetService";

const router = Router();

const APP_JWT_SECRET = process.env.APP_JWT_SECRET;
if (!APP_JWT_SECRET) {
  console.warn("⚠️ APP_JWT_SECRET is missing in .env");
}

function signToken(payload: any) {
  if (!APP_JWT_SECRET) throw new Error("APP_JWT_SECRET not set");
  const permissionScopes = Array.isArray(payload.permission_scopes) ? payload.permission_scopes : [];
  return jwt.sign(
    {
      ...payload,
      permission_scopes: permissionScopes,
      permissions: permissionsForRole(payload.role, permissionScopes),
    },
    APP_JWT_SECRET,
    { expiresIn: "30d" }
  );
}

function cleanEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

async function auditAuthEvent(
  action: string,
  status: "success" | "failed",
  metadata: Record<string, any>,
  req: any,
  actor?: { id?: string | null; email?: string | null; role?: string | null; estateId?: string | null; homeId?: string | null }
) {
  await emitAuditEvent({
    actorId: actor?.id || undefined,
    actorEmail: actor?.email || undefined,
    actorRole: actor?.role || undefined,
    estateId: actor?.estateId || undefined,
    homeId: actor?.homeId || undefined,
    action,
    resourceType: "auth",
    resourceId: actor?.email || metadata.email || metadata.request_email || "password_reset",
    status,
    metadata,
    req,
  });
}

function requireOtpGate(
  req: any,
  res: any,
  expectedPurpose: "signup" | "login"
) {
  const otpToken =
    (req.headers["x-otp-token"] as string) ||
    (req.body?.otpToken as string) ||
    "";

  if (!otpToken) {
    res.status(401).json({ error: "OTP required. Please verify your email first." });
    return null;
  }

  try {
    if (!APP_JWT_SECRET) throw new Error("APP_JWT_SECRET not set");

    const decoded = jwt.verify(otpToken, APP_JWT_SECRET) as any;

    if (decoded?.typ !== "otp") {
      res.status(401).json({ error: "Invalid OTP token" });
      return null;
    }

    if (!decoded?.email || !decoded?.purpose) {
      res.status(401).json({ error: "Invalid OTP token payload" });
      return null;
    }

    if (decoded.purpose !== expectedPurpose) {
      res
        .status(401)
        .json({ error: `OTP token purpose mismatch (${expectedPurpose} required)` });
      return null;
    }

    return {
      email: String(decoded.email).trim().toLowerCase(),
      purpose: decoded.purpose as "signup" | "login",
    };
  } catch {
    res.status(401).json({ error: "OTP token expired or invalid. Please verify again." });
    return null;
  }
}

// ---------------------- SIGNUP ----------------------
router.post("/signup", async (req, res) => {
  try {
    const { email, password, full_name } = req.body;

    const gate = requireOtpGate(req, res, "signup");
    if (!gate) return;

    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!cleanEmail || !password || !full_name) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (cleanEmail !== gate.email) {
      return res
        .status(400)
        .json({ error: "Email mismatch (OTP email must match signup email)" });
    }

    // 1) Check if user exists
    const { data: existing, error: existErr } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", cleanEmail)
      .maybeSingle();

    if (existErr) return res.status(500).json({ error: existErr.message });
    if (existing) return res.status(400).json({ error: "Email already registered" });

    // 2) Create user
    const hash = await bcrypt.hash(password, 10);

    const { data: createdUser, error: createErr } = await supabaseAdmin
      .from("users")
      .insert({
        email: cleanEmail,
        full_name,
        password_hash: hash,
        role: "resident",
        // email_verified: true, // ❌ only add if your schema has it
      })
      .select()
      .single();

    if (createErr) return res.status(500).json({ error: createErr.message });

    // 3) Create estate for the user
    const estateName = `${full_name} Estate`;

    const { data: estate, error: estateErr } = await supabaseAdmin
      .from("estates")
      .insert({
        name: estateName,
        owner_id: createdUser.id,
      })
      .select()
      .single();

    if (estateErr) return res.status(500).json({ error: estateErr.message });

    // 4) Link user -> estate and upgrade role
    const { data: updatedUser, error: linkErr } = await supabaseAdmin
      .from("users")
      .update({
        estate_id: estate.id,
        role: "estate_admin",
      })
      .eq("id", createdUser.id)
      .select()
      .single();

    if (linkErr) return res.status(500).json({ error: linkErr.message });

    // 5) Issue session token
    const token = signToken({
      id: updatedUser.id,
      role: updatedUser.role,
      email: updatedUser.email,
      estate_id: updatedUser.estate_id,
      home_id: updatedUser.home_id,
      permission_scopes: Array.isArray((updatedUser as any).permission_scopes) ? (updatedUser as any).permission_scopes : [],
    });

    return res.json({
      message: "Signup successful",
      user: updatedUser,
      token,
      estate,
    });
  } catch (err) {
    console.error("signup error:", err);
    return res.status(500).json({ error: "Unexpected server error" });
  }
});

// ---------------------- LOGIN ----------------------
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!cleanEmail || !password) {
      return res.status(400).json({ error: "Missing email or password" });
    }

    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("email", cleanEmail)
      .single();

    if (error || !user) return res.status(400).json({ error: "Invalid email or password" });
    if (String(user.account_status || "active") === "suspended") {
      return res.status(403).json({ error: "Account is suspended. Contact support." });
    }

    if (!user.password_hash) {
      return res.status(400).json({ error: "Account not fully set up" });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(400).json({ error: "Invalid email or password" });

    const requireLoginOtp =
      String(process.env.REQUIRE_OTP_LOGIN || "").toLowerCase() === "true";

    if (requireLoginOtp) {
      const gate = requireOtpGate(req, res, "login");
      if (!gate) return;

      if (gate.email !== cleanEmail) {
        return res
          .status(400)
          .json({ error: "Email mismatch (OTP email must match login email)" });
      }
    }

    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      estate_id: user.estate_id,
      home_id: user.home_id,
      permission_scopes: Array.isArray((user as any).permission_scopes) ? (user as any).permission_scopes : [],
    });

    return res.json({ message: "Login successful", user, token });
  } catch (err) {
    console.error("login error:", err);
    return res.status(500).json({ error: "Unexpected server error" });
  }
});

router.post("/password/forgot", async (req, res) => {
  const email = cleanEmail(req.body?.email);
  if (!email || !email.includes("@")) {
    return res.status(400).json({ ok: false, error: "Valid email required" });
  }

  try {
    const allowed = await canSendOtp(email, "password_reset");
    if (!allowed) {
      await auditAuthEvent("auth.password.reset.requested", "failed", { request_email: email, reason: "rate_limited" }, req);
      return res.status(429).json({
        ok: false,
        error: "Too many password reset attempts. Please wait and try again.",
      });
    }

    const { data: user } = await supabaseAdmin
      .from("users")
      .select("id, email, role, estate_id, home_id, account_status")
      .eq("email", email)
      .maybeSingle();

    if (user && String(user.account_status || "active") !== "suspended") {
      const code = generateOtpCode(6);
      await saveOtp(email, "password_reset", code);
      await sendOtpEmail({ to: email, code, purpose: "password_reset" });
      await auditAuthEvent(
        "auth.password.reset.requested",
        "success",
        { email, delivery: "otp", account_found: true },
        req,
        { id: user.id, email: user.email, role: user.role, estateId: user.estate_id, homeId: user.home_id }
      );
    } else {
      await auditAuthEvent("auth.password.reset.requested", "success", { email, delivery: "suppressed", account_found: false }, req);
    }

    return res.json({
      ok: true,
      message: "If an account exists for that email, password recovery instructions have been sent.",
      mode: "otp",
    });
  } catch (error: any) {
    console.error("password forgot error:", error);
    await auditAuthEvent("auth.password.reset.requested", "failed", { request_email: email, reason: error?.message || "unexpected_error" }, req);
    return res.status(500).json({ ok: false, error: "Unable to start password recovery" });
  }
});

router.post("/password/verify-reset", async (req, res) => {
  const email = cleanEmail(req.body?.email);
  const otp = String(req.body?.otp || req.body?.code || "").trim();

  if (!email || !email.includes("@")) {
    return res.status(400).json({ ok: false, error: "Valid email required" });
  }
  if (!otp || otp.length < 4) {
    return res.status(400).json({ ok: false, error: "Valid reset code required" });
  }

  try {
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("id, email, role, estate_id, home_id")
      .eq("email", email)
      .maybeSingle();

    const result = await verifyOtp(email, "password_reset", otp);
    if (!result.ok || !user) {
      await auditAuthEvent("auth.password.reset.verified", "failed", { email, reason: result.ok ? "account_not_found" : result.reason }, req);
      return res.status(401).json({ ok: false, error: "Reset code expired or invalid" });
    }

    const { token, jti } = signPasswordResetToken(email);
    await storePasswordResetToken(email, jti);
    await auditAuthEvent(
      "auth.password.reset.verified",
      "success",
      { email, reset_session: "issued" },
      req,
      { id: user.id, email: user.email, role: user.role, estateId: user.estate_id, homeId: user.home_id }
    );

    return res.json({
      ok: true,
      message: "Reset code verified",
      resetToken: token,
      expiresInSeconds: 10 * 60,
    });
  } catch (error: any) {
    console.error("password verify-reset error:", error);
    await auditAuthEvent("auth.password.reset.verified", "failed", { email, reason: error?.message || "unexpected_error" }, req);
    return res.status(500).json({ ok: false, error: "Unable to verify reset code" });
  }
});

router.post("/password/reset", async (req, res) => {
  const email = cleanEmail(req.body?.email);
  const resetToken = String(req.body?.resetToken || "").trim();
  const password = String(req.body?.password || "");

  if (!email || !email.includes("@")) {
    return res.status(400).json({ ok: false, error: "Valid email required" });
  }
  if (!resetToken) {
    return res.status(400).json({ ok: false, error: "Reset token required" });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ ok: false, error: "Password must be at least 8 characters" });
  }

  try {
    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("id, email, role, estate_id, home_id, password_hash")
      .eq("email", email)
      .maybeSingle();

    if (error || !user) {
      await auditAuthEvent("auth.password.reset.completed", "failed", { email, reason: error?.message || "account_not_found" }, req);
      return res.status(400).json({ ok: false, error: "Unable to reset password" });
    }

    const consumed = await consumePasswordResetToken(email, resetToken);
    if (!consumed.ok) {
      await auditAuthEvent(
        "auth.password.reset.completed",
        "failed",
        { email, reason: consumed.reason },
        req,
        { id: user.id, email: user.email, role: user.role, estateId: user.estate_id, homeId: user.home_id }
      );
      return res.status(401).json({ ok: false, error: "Reset session expired or invalid" });
    }

    const hash = await bcrypt.hash(password, 10);
    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({ password_hash: hash })
      .eq("id", user.id);

    if (updateError) {
      await auditAuthEvent(
        "auth.password.reset.completed",
        "failed",
        { email, reason: updateError.message, reset_session: consumed.jti },
        req,
        { id: user.id, email: user.email, role: user.role, estateId: user.estate_id, homeId: user.home_id }
      );
      return res.status(500).json({ ok: false, error: "Unable to reset password" });
    }

    await auditAuthEvent(
      "auth.password.reset.completed",
      "success",
      {
        email,
        reset_session: consumed.jti,
        session_invalidation: "not_supported_by_current_stateless_jwt_model",
      },
      req,
      { id: user.id, email: user.email, role: user.role, estateId: user.estate_id, homeId: user.home_id }
    );

    return res.json({
      ok: true,
      message: "Password reset successful",
    });
  } catch (error: any) {
    console.error("password reset error:", error);
    await auditAuthEvent("auth.password.reset.completed", "failed", { email, reason: error?.message || "unexpected_error" }, req);
    return res.status(500).json({ ok: false, error: "Unable to reset password" });
  }
});

export default router;
