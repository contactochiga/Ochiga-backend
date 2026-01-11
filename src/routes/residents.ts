import express from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import crypto from "crypto";
import QRCode from "qrcode";
import bcrypt from "bcrypt";

const router = express.Router();

/**
 * POST /residents
 * Create resident + onboarding
 *
 * Allowed roles:
 * - estate_admin
 * - manager
 * - system_admin (implicit override)
 */
router.post(
  "/",
  requireAuth,
  requireRole("estate_admin", "manager"),
  async (req, res) => {
    const { email, estateId, homeId, fullName, phone } = req.body;

    if (!email || !estateId) {
      return res.status(400).json({
        error: "email and estateId required",
      });
    }

    try {
      // 1 — Generate temporary password
      const tempPassword = "OC-" + Math.floor(10000 + Math.random() * 90000);
      const hashedPassword = await bcrypt.hash(tempPassword, 10);

      // 2 — Create resident user
      const { data: user, error: userError } = await supabaseAdmin
        .from("users")
        .insert([
          {
            email,
            password: hashedPassword,
            full_name: fullName || null,
            phone: phone || null,
            role: "resident",
            estate_id: estateId,
            home_id: homeId || null,
          },
        ])
        .select()
        .single();

      if (userError) {
        return res.status(500).json({ error: userError.message });
      }

      // 3 — Create onboarding token
      const token = crypto.randomUUID();

      const { error: tokenError } = await supabaseAdmin
        .from("onboarding_tokens")
        .insert([
          {
            user_id: user.id,
            token,
            used: false,
          },
        ]);

      if (tokenError) {
        return res.status(500).json({ error: tokenError.message });
      }

      // 4 — Generate onboarding URL
      const onboardingUrl = `https://your-domain.com/onboard/${token}`;

      // 5 — Generate QR code
      const qrDataUrl = await QRCode.toDataURL(onboardingUrl);

      return res.json({
        message: "Resident created successfully",
        user,
        onboardingUrl,
        qrDataUrl,
        tempPassword, // optional: remove in production
      });
    } catch (err: any) {
      console.error("Create resident error:", err);
      return res.status(500).json({
        error: "Server error",
        details: err.message,
      });
    }
  }
);

export default router;
