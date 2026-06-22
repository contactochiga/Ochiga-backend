import express from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { getUserNotificationPreferences, upsertUserNotificationPreference, type NotificationCategory } from "../services/notificationPolicyService";
import { withNotificationRouting } from "../services/notifications/notificationRoutingService";

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
  return res.json({ items: (data || []).map(withNotificationRouting) });
});

router.get("/preferences", requireAuth, requirePermission("notifications.read"), async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  try {
    const items = await getUserNotificationPreferences(String(user.id));
    return res.json({ items });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Failed to load notification preferences" });
  }
});

router.patch("/preferences/:category", requireAuth, requirePermission("notifications.read"), async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  try {
    const item = await upsertUserNotificationPreference(String(user.id), String(req.params.category || "") as NotificationCategory, req.body || {});
    return res.json({ ok: true, item });
  } catch (error: any) {
    return res.status(error?.statusCode || 400).json({ error: error?.message || "Failed to update notification preference" });
  }
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

  return res.json({ ok: true, item: data ? withNotificationRouting(data) : data });
});

// Canonical acknowledgement alias for activity/notification consumers.
router.post("/ack/:id", requireAuth, requirePermission("notifications.read"), async (req, res) => {
  const user = req.user;
  const { id } = req.params;

  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { data, error } = await markNotificationAcknowledged(id, String(user.id));

  if (error) return res.status(500).json({ error: error.message });

  return res.json({ ok: true, item: data ? withNotificationRouting(data) : data });
});

router.patch("/:id/lifecycle", requireAuth, requirePermission("notifications.manage"), async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  const status = String(req.body?.status || "").toLowerCase();
  if (!["acknowledged", "assigned", "resolved"].includes(status)) return res.status(400).json({ error: "Unsupported notification lifecycle state" });
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status, updated_at: now };
  if (status === "acknowledged") patch.acknowledged_at = now;
  if (status === "assigned") { patch.assigned_at = now; patch.assigned_to = req.body?.assigned_to || null; }
  if (status === "resolved") { patch.resolved_at = now; patch.resolution_note = req.body?.resolution_note || null; }
  let query = supabaseAdmin.from("notifications").update(patch as any).eq("id", req.params.id);
  if (user.estate_id) query = query.eq("estate_id", user.estate_id);
  else query = query.eq("user_id", user.id);
  const { data, error } = await query.select().single();
  if (error) return res.status(400).json({ error: "Unable to update notification lifecycle" });
  return res.json({ ok: true, item: data ? withNotificationRouting(data) : data });
});

export default router;
