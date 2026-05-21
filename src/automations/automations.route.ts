// src/automations/automations.route.ts
import express from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { requireAuth, requirePermission } from "../middleware/auth";
import { auditOnSuccess } from "../middleware/audit";
import { nluToAutomation } from "../utils/ai";
import { AutomationSchema, AutomationInputSchema } from "../utils/validation";
import { z } from "zod";

const router = express.Router();

/**
 * ==========================================
 * POST /automations
 * Create automation manually
 * Roles: estate_admin, manager, operator
 * ==========================================
 */
router.post(
  "/",
  requireAuth,
  requirePermission("devices.control"),
  auditOnSuccess("automation.created", "automation", "id"),
  async (req, res) => {
    try {
      const parsed = AutomationInputSchema.parse(req.body);

      const { data, error } = await supabaseAdmin
        .from("automations")
        .insert([parsed])
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.errors });
      }
      return res.status(500).json({ error: "Invalid payload" });
    }
  }
);

/**
 * ==========================================
 * GET /automations?estateId=
 * Fetch automations
 * Roles: authenticated users (filtered by estate)
 * ==========================================
 */
router.get("/", requireAuth, requirePermission("devices.read"), async (req, res) => {
  const estateId = req.query.estateId as string | undefined;

  let query = supabaseAdmin.from("automations").select("*");
  if (estateId) query = query.eq("estate_id", estateId);

  const { data, error } = await query;

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

/**
 * ==========================================
 * POST /automations/ai-suggest
 * Natural language → automation
 * Roles: estate_admin, manager, operator
 * ==========================================
 */
router.post(
  "/ai-suggest",
  requireAuth,
  requirePermission("devices.control"),
  auditOnSuccess("automation.created", "automation", "id"),
  async (req, res) => {
    try {
      const { prompt, estateId } = req.body;

      if (!prompt || !estateId) {
        return res.status(400).json({ error: "Missing prompt or estateId" });
      }

      // Fetch estate devices for context
      const { data: devices } = await supabaseAdmin
        .from("devices")
        .select("*")
        .eq("estate_id", estateId);

      const nluContext = {
        devices: Array.isArray(devices) ? devices : [],
        homes: [],
        estates: [],
      };

      const suggestion = await nluToAutomation(prompt, nluContext);

      const parsed = AutomationSchema.parse({
        ...suggestion,
        estate_id: estateId,
        ai_generated: true,
        created_at: new Date().toISOString(),
      });

      const { data, error } = await supabaseAdmin
        .from("automations")
        .insert([parsed])
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.errors });
      }
      console.error("ai-suggest error", err);
      return res.status(500).json({ error: "AI or server error" });
    }
  }
);

/**
 * ==========================================
 * POST /automations/:id/trigger
 * Manually trigger automation
 * Roles: estate_admin, manager, operator
 * ==========================================
 */
router.post(
  "/:id/trigger",
  requireAuth,
  requirePermission("devices.control"),
  auditOnSuccess("automation.triggered", "automation", "id"),
  async (req, res) => {
    const id = req.params.id;

    try {
      const { enqueueAutomation } = await import("../workers/automationWorker");
      await enqueueAutomation(id);
      return res.json({ ok: true, message: "Automation enqueued" });
    } catch (err) {
      console.error("trigger error", err);
      return res.status(500).json({ error: "Failed to enqueue automation" });
    }
  }
);

export default router;
