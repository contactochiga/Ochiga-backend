// src/routes/estates.ts
import { Router } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import crypto from "crypto";
import QRCode from "qrcode";

const router = Router();

/**
 * Legacy-compatible endpoint:
 * POST /estates/create-home
 *
 * What it now does (NEW MODEL):
 * 1) Ensures user exists (NO password for invite users)
 * 2) Creates home
 * 3) Creates estate_membership + home_membership
 * 4) Creates an invite link + QR (so user can finish onboarding)
 */
router.post("/create-home", async (req, res) => {
  try {
    const { estate_id, home_name, owner_email, owner_username, full_name } =
      req.body;

    if (!estate_id || !home_name || !owner_email) {
      return res.status(400).json({
        error: "estate_id, home_name, owner_email are required",
      });
    }

    // 0) Confirm estate exists
    const { data: estate, error: estateErr } = await supabaseAdmin
      .from("estates")
      .select("id")
      .eq("id", estate_id)
      .single();

    if (estateErr || !estate) {
      return res.status(400).json({ error: "Invalid estate_id" });
    }

    // 1) Find or create user
    const { data: existingUser, error: findErr } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("email", owner_email)
      .maybeSingle();

    if (findErr) return res.status(500).json({ error: findErr.message });

    let user = existingUser;

    if (!user) {
      const { data: created, error: createUserErr } = await supabaseAdmin
        .from("users")
        .insert({
          email: owner_email,
          username: owner_username || null,
          full_name: full_name || null,

          // ✅ IMPORTANT:
          // Invite-created users DO NOT have password_hash yet
          password_hash: null,

          role: "resident",

          // keep legacy columns if you still use them in frontend queries
          estate_id,
          home_id: null,
        })
        .select()
        .single();

      if (createUserErr) {
        return res.status(400).json({ error: createUserErr.message });
      }
      user = created;
    }

    // 2) Create home
    const { data: home, error: homeErr } = await supabaseAdmin
      .from("homes")
      .insert({
        estate_id,
        name: home_name,
        resident_id: user.id, // legacy convenience
      })
      .select()
      .single();

    if (homeErr) {
      return res.status(400).json({ error: homeErr.message });
    }

    // 3) Upsert estate membership
    const { error: estateMemberErr } = await supabaseAdmin
      .from("estate_memberships")
      .upsert(
        {
          estate_id,
          user_id: user.id,
          role: "resident",
          status: "active",
        },
        { onConflict: "estate_id,user_id" }
      );

    if (estateMemberErr) {
      return res.status(500).json({ error: estateMemberErr.message });
    }

    // 4) Upsert home membership (owner)
    const { error: homeMemberErr } = await supabaseAdmin
      .from("home_memberships")
      .upsert(
        {
          home_id: home.id,
          user_id: user.id,
          role: "owner",
          status: "active",
        },
        { onConflict: "home_id,user_id" }
      );

    if (homeMemberErr) {
      return res.status(500).json({ error: homeMemberErr.message });
    }

    // 5) Create invite token (link/QR)
    // We store only token_hash in DB (safer). Raw token only shown once.
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    const { error: inviteErr } = await supabaseAdmin.from("invites").insert({
      created_by: null,
      estate_id,
      home_id: home.id,
      role: "owner",
      invite_type: "link",
      token_hash: tokenHash,
      invited_email: owner_email,
      status: "pending",
      // expires_at default in SQL
    });

    if (inviteErr) {
      return res.status(500).json({ error: inviteErr.message });
    }

    // 🔥 Your consumer/facility frontend URL should handle this route:
    // e.g. https://oyi.com/auth/invite?token=...
    const inviteUrl = `${process.env.VISITOR_LINK_BASE || "https://oyi.com"}/auth/invite?token=${rawToken}`;
    const qrDataUrl = await QRCode.toDataURL(inviteUrl);

    return res.json({
      message: "Home created + membership granted + invite generated",
      user,
      home,
      inviteUrl,
      qrDataUrl,
    });
  } catch (err) {
    console.error("Create Home Error:", err);
    return res.status(500).json({ error: "Unexpected server error" });
  }
});

export default router;
