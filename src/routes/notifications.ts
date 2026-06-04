import express from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { supabaseAdmin } from "../supabase/supabaseClient";

const router = express.Router();

async function markNotificationAcknowledged(id: string, userId: string) {
  return supabaseAdmin
    .from("notifications")
    .update({
      status: "read",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();
}

// =============================
// GET notifications for user
// Supports:
//  - /notifications              -> all
//  - /notifications?unread=true  -> only unread (status != "read" OR null)
// =============================
router.get("/", requireAuth, requirePermission("notifications.read"), async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const unread = String(req.query.unread || "").toLowerCase() === "true";

  // Base query
  let q = supabaseAdmin
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  // ✅ unread filter
  // Treat null/empty status as unread too (legacy safety)
  if (unread) {
    // If status is text and "read" marks read
    // We want everything NOT read (including null)
    q = q.or("status.is.null,status.neq.read");
  }

  const { data, error } = await q;

  if (error) return res.status(500).json({ error: error.message });

  // ✅ wrap with items (your UI supports both, but this is cleaner)
  return res.json({ items: data || [] });
});

// =============================
// MARK notification as read
// =============================
router.post("/read/:id", requireAuth, requirePermission("notifications.read"), async (req, res) => {
  const user = req.user;
  const { id } = req.params;

  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { data, error } = await markNotificationAcknowledged(id, String(user.id));

  if (error) return res.status(500).json({ error: error.message });

  return res.json({ ok: true, item: data });
});

// Canonical acknowledgement alias for activity/notification consumers.
router.post("/ack/:id", requireAuth, requirePermission("notifications.read"), async (req, res) => {
  const user = req.user;
  const { id } = req.params;

  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { data, error } = await markNotificationAcknowledged(id, String(user.id));

  if (error) return res.status(500).json({ error: error.message });

  return res.json({ ok: true, item: data });
});

export default router;
