// src/routes/residents.ts
import express from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { requireAuth, requirePermission } from "../middleware/auth";
import { auditOnSuccess } from "../middleware/audit";
import crypto from "crypto";
import QRCode from "qrcode";

const router = express.Router();

/**
 * POST /residents
 * Creates a resident (invite-based: no password stored).
 */
router.post(
  "/",
  requireAuth,
  requirePermission("staff.manage"),
  auditOnSuccess("user.invited", "resident", "email"),
  async (req, res) => {
    const { email, estateId, homeId, fullName } = req.body;

    if (!email || !estateId) {
      return res.status(400).json({ error: "email and estateId required" });
    }

    try {
      // 1) Find or create user
      const { data: existingUser, error: findErr } = await supabaseAdmin
        .from("users")
        .select("*")
        .eq("email", email)
        .maybeSingle();

      if (findErr) return res.status(500).json({ error: findErr.message });

      let user = existingUser;

      if (!user) {
        const { data: created, error: createErr } = await supabaseAdmin
          .from("users")
          .insert({
            email,
            full_name: fullName || null,
            password_hash: null, // ✅ invite-based
            role: "resident",

            // keep legacy columns if you still use them
            estate_id: estateId,
            home_id: homeId || null,
          })
          .select()
          .single();

        if (createErr) return res.status(500).json({ error: createErr.message });
        user = created;
      }

      // 2) Upsert estate membership
      const { error: emErr } = await supabaseAdmin
        .from("estate_memberships")
        .upsert(
          {
            estate_id: estateId,
            user_id: user.id,
            role: "resident",
            status: "active",
          },
          { onConflict: "estate_id,user_id" }
        );

      if (emErr) return res.status(500).json({ error: emErr.message });

      // 3) If homeId, upsert home membership too
      if (homeId) {
        const { error: hmErr } = await supabaseAdmin
          .from("home_memberships")
          .upsert(
            {
              home_id: homeId,
              user_id: user.id,
              role: "member",
              status: "active",
            },
            { onConflict: "home_id,user_id" }
          );

        if (hmErr) return res.status(500).json({ error: hmErr.message });
      }

      // 4) Create invite
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

      const { error: inviteErr } = await supabaseAdmin.from("invites").insert({
        created_by: req.user?.id || null,
        estate_id: estateId,
        home_id: homeId || null,
        role: homeId ? "member" : "resident",
        invite_type: "link",
        token_hash: tokenHash,
        invited_email: email,
        status: "pending",
      });

      if (inviteErr) return res.status(500).json({ error: inviteErr.message });

      const inviteUrl = `${process.env.VISITOR_LINK_BASE || "https://oyi.com"}/auth/invite?token=${rawToken}`;
      const qrDataUrl = await QRCode.toDataURL(inviteUrl);

      return res.json({
        message: "Resident created + membership granted + invite generated",
        user,
        inviteUrl,
        qrDataUrl,
      });
    } catch (err: any) {
      console.error("Create resident error:", err);
      return res.status(500).json({ error: "Server error", details: err.message });
    }
  }
);

export default router;
