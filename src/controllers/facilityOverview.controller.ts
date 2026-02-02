// src/controllers/facilityOverview.controller.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";

type AuthenticatedRequest = Request & {
  user?: { id: string; estate_id?: string; role?: string };
};

type AmountRow = { amount: number };

// ---------------------------
// Helpers
// ---------------------------
function extractErrMsg(e: any) {
  return String(e?.message || e?.error?.message || "");
}

function missingColumn(msg: string) {
  if (!msg) return null;

  const m1 = msg.match(/column\s+"([^"]+)"/i);
  if (m1?.[1]) return m1[1];

  const m2 = msg.match(/Could not find the ['"]([^'"]+)['"] column/i);
  if (m2?.[1]) return m2[1];

  return null;
}

/**
 * Count devices that are "active" without crashing if schema differs.
 *
 * Priority:
 * 1) status in (online/active) OR last_seen within 5mins
 * 2) status in (online/active) only
 * 3) fallback: total devices in estate
 */
async function countActiveDevices(estateId: string) {
  const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  // 1) Best attempt: status OR last_seen
  const q1 = await supabaseAdmin
    .from("devices")
    .select("*", { count: "exact", head: true })
    .eq("estate_id", estateId)
    .or(`status.eq.online,status.eq.active,last_seen.gte.${fiveMinsAgo}`);

  if (!q1.error) return q1.count || 0;

  const col1 = missingColumn(String(q1.error.message || ""));
  // If last_seen doesn't exist, retry using status only
  if (col1 === "last_seen") {
    const q2 = await supabaseAdmin
      .from("devices")
      .select("*", { count: "exact", head: true })
      .eq("estate_id", estateId)
      .in("status", ["online", "active"]);

    if (!q2.error) return q2.count || 0;
  }

  // If status doesn't exist or statuses are different, just show "registered devices"
  const q3 = await supabaseAdmin
    .from("devices")
    .select("*", { count: "exact", head: true })
    .eq("estate_id", estateId);

  return q3.count || 0;
}

/**
 * Count unread notifications without crashing if schema differs.
 *
 * Priority:
 * 1) read == false
 * 2) read_at is null
 * 3) fallback: 0
 */
async function countUnreadAlerts(estateId: string) {
  const q1 = await supabaseAdmin
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("estate_id", estateId)
    .eq("read", false);

  if (!q1.error) return q1.count || 0;

  const col1 = missingColumn(String(q1.error.message || ""));
  if (col1 === "read") {
    const q2 = await supabaseAdmin
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("estate_id", estateId)
      .is("read_at", null);

    if (!q2.error) return q2.count || 0;
  }

  return 0;
}

// ---------------------------
// Controller
// ---------------------------
export const getFacilityOverview = async (req: AuthenticatedRequest, res: Response) => {
  try {
    let estateId = req.user?.estate_id;

    // ✅ Fallback: membership-driven estate selection
    if (!estateId && req.user?.id) {
      const { data: mem, error: memErr } = await supabaseAdmin
        .from("estate_memberships")
        .select("estate_id, status")
        .eq("user_id", req.user.id)
        .eq("status", "active")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (memErr) return res.status(500).json({ error: memErr.message });
      estateId = mem?.estate_id || undefined;
    }

    if (!estateId) {
      return res.status(400).json({ error: "No estate linked. Create or join an estate." });
    }

    // 1. Total Homes
    const { count: totalHomes, error: homesErr } = await supabaseAdmin
      .from("homes")
      .select("*", { count: "exact", head: true })
      .eq("estate_id", estateId);

    if (homesErr) return res.status(500).json({ error: homesErr.message });

    // 2. Active Devices (✅ schema-safe)
    const activeDevices = await countActiveDevices(estateId);

    // 3. Open Maintenance
    const { count: openMaintenance, error: maintErr } = await supabaseAdmin
      .from("maintenance_requests")
      .select("*", { count: "exact", head: true })
      .eq("estate_id", estateId)
      .in("status", ["open", "in_progress"]);

    if (maintErr) return res.status(500).json({ error: maintErr.message });

    // 4. Visitors Today
    const today = new Date().toISOString().split("T")[0];

    const { count: visitorsToday, error: visitorsErr } = await supabaseAdmin
      .from("visitors")
      .select("*", { count: "exact", head: true })
      .eq("estate_id", estateId)
      .gte("created_at", `${today}T00:00:00`)
      .lte("created_at", `${today}T23:59:59`);

    if (visitorsErr) return res.status(500).json({ error: visitorsErr.message });

    // 5. Alerts (Unread) (✅ schema-safe)
    const alerts = await countUnreadAlerts(estateId);

    // 6. Wallet Summary
    const { data: wallet, error: walletErr } = await supabaseAdmin
      .from("estate_wallets")
      .select("balance")
      .eq("estate_id", estateId)
      .maybeSingle();

    if (walletErr) return res.status(500).json({ error: walletErr.message });

    const { data: dues, error: duesErr } = await supabaseAdmin
      .from("dues")
      .select("amount")
      .eq("estate_id", estateId)
      .eq("status", "unpaid");

    if (duesErr) return res.status(500).json({ error: duesErr.message });

    const { data: payments, error: payErr } = await supabaseAdmin
      .from("payments")
      .select("amount")
      .eq("estate_id", estateId)
      .gte("created_at", `${today.slice(0, 7)}-01`);

    if (payErr) return res.status(500).json({ error: payErr.message });

    const totalOutstanding =
      (dues as AmountRow[] | null)?.reduce((sum, d) => sum + Number(d.amount || 0), 0) || 0;

    const collectedThisMonth =
      (payments as AmountRow[] | null)?.reduce((sum, p) => sum + Number(p.amount || 0), 0) || 0;

    return res.json({
      estate_id: estateId,
      homes: totalHomes || 0,
      active_devices: activeDevices || 0,
      open_maintenance: openMaintenance || 0,
      visitors_today: visitorsToday || 0,
      alerts: alerts || 0,
      wallet: {
        balance: wallet?.balance || 0,
        outstanding_dues: totalOutstanding,
        collected_this_month: collectedThisMonth,
      },
    });
  } catch (error: any) {
    console.error("Facility overview error:", extractErrMsg(error) || error);
    return res.status(500).json({ error: "Failed to load facility overview" });
  }
};
