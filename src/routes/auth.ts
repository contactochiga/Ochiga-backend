// src/routes/auth.ts
import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { supabaseAdmin } from "../supabase/supabaseClient";

const router = Router();

const APP_JWT_SECRET = process.env.APP_JWT_SECRET;
if (!APP_JWT_SECRET) {
  console.warn("⚠️ APP_JWT_SECRET is missing in .env");
}

function signToken(payload: any) {
  if (!APP_JWT_SECRET) throw new Error("APP_JWT_SECRET not set");
  return jwt.sign(payload, APP_JWT_SECRET, { expiresIn: "30d" });
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
    });

    return res.json({ message: "Login successful", user, token });
  } catch (err) {
    console.error("login error:", err);
    return res.status(500).json({ error: "Unexpected server error" });
  }
});

export default router;
