// src/routes/auth.ts
import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { supabaseAdmin } from "../supabase/supabaseClient";

const router = Router();
const APP_JWT_SECRET = process.env.APP_JWT_SECRET!;

// Token signer
function signToken(payload: any) {
  return jwt.sign(payload, APP_JWT_SECRET, { expiresIn: "30d" });
}

// ---------------------- SIGNUP ----------------------
router.post("/signup", async (req, res) => {
  try {
    const { email, password, full_name } = req.body;

    // ✅ basic validation (prevents weird null inserts)
    if (!email || !password || !full_name) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // 1) Check if user exists
    const { data: existing, error: existErr } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existErr) return res.status(500).json({ error: existErr.message });
    if (existing) return res.status(400).json({ error: "Email already registered" });

    // 2) Create user
    const hash = await bcrypt.hash(password, 10);

    const { data: createdUser, error: createErr } = await supabaseAdmin
      .from("users")
      .insert({
        email,
        full_name,
        password_hash: hash, // ✅ requires this column (you just added it)
        role: "resident", // temporary until estate is created/linked
      })
      .select()
      .single();

    if (createErr) return res.status(500).json({ error: createErr.message });

    // 3) Create estate for the user (Option A)
    // ⚠️ If your estates table uses different column names, adjust here:
    // - name (text)
    // - owner_id (uuid) OR created_by (uuid)
    const estateName = `${full_name} Estate`;

    const { data: estate, error: estateErr } = await supabaseAdmin
      .from("estates")
      .insert({
        name: estateName,
        owner_id: createdUser.id, // change to created_by if your schema uses that
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

    // 5) Token includes estate_id so the Overview stops saying "Estate not linked"
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
    console.error(err);
    return res.status(500).json({ error: "Unexpected server error" });
  }
});

// ---------------------- LOGIN ----------------------
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("email", email)
      .single();

    if (error || !user)
      return res.status(400).json({ error: "Invalid email or password" });

    if (!user.password_hash)
      return res.status(400).json({ error: "Account not fully set up" });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(400).json({ error: "Invalid email or password" });

    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      estate_id: user.estate_id,
      home_id: user.home_id,
    });

    return res.json({ message: "Login successful", user, token });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Unexpected server error" });
  }
});

export default router;
