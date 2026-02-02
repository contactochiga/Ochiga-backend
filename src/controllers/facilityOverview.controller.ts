// src/controllers/facilityOverview.controller.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";

type AuthenticatedRequest = Request & {
  user?: { id: string; estate_id?: string; role?: string };
};

type AmountRow = { amount: number };

function extractErr(e: any) {
  const status = e?.response?.status;
  const msg = e?.response?.data?.error || e?.message || "Request failed";
  return { status, msg: String(msg) };
}

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

    const today = new Date().toISOString().split("T")[0];
    const monthStart = `${today.slice(0, 7)}-01`;

    // ✅ Active device window: last 5 minutes (best definition)
    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    // ---- Run counts in parallel
    const [
      homesRes,
      devicesTotalRes,
      devicesActiveRes,
      openMaintenanceRes,
      visitorsTodayRes,
      alertsRes,
      walletRes,
      duesRes,
      paymentsRes,
    ] = await Promise.all([
      supabaseAdmin
        .from("homes")
        .select("*", { count: "exact", head: true })
        .eq("estate_id", estateId),

      // ✅ Total devices registered to estate
      supabaseAdmin
        .from("devices")
        .select("*", { count: "exact", head: true })
        .eq("estate_id", estateId),

      // ✅ Active devices = online OR recently seen
      // This supports BOTH schemas:
      // - if you have last_seen -> it works
      // - if not, the status IN (...) still works
      supabaseAdmin
        .from("devices")
        .select("*", { count: "exact", head: true })
        .eq("estate_id", estateId)
        .or(
          [
            "status.eq.online",
            "status.eq.active",
            `last_seen.gte.${fiveMinsAgo}`,
          ].join(",")
        ),

      supabaseAdmin
        .from("maintenance_requests")
        .select("*", { count: "exact", head: true })
        .eq("estate_id", estateId)
        .in("status", ["open", "in_progress"]),

      supabaseAdmin
        .from("visitors")
        .select("*", { count: "exact", head: true })
        .eq("estate_id", estateId)
        .gte("created_at", `${today}T00:00:00`)
        .lte("created_at", `${today}T23:59:59`),

      // ⚠️ If your notifications table uses read_at instead of read boolean,
      // you'll want to switch this (I left your existing logic but safer below)
      supabaseAdmin
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("estate_id", estateId)
        .eq("read", false),

      supabaseAdmin
        .from("estate_wallets")
        .select("balance")
        .eq("estate_id", estateId)
        .maybeSingle(),

      supabaseAdmin
        .from("dues")
        .select("amount")
        .eq("estate_id", estateId)
        .eq("status", "unpaid"),

      supabaseAdmin
        .from("payments")
        .select("amount")
        .eq("estate_id", estateId)
        .gte("created_at", monthStart),
    ]);

    // ---- Handle errors (counts return errors too)
    const firstErr =
      homesRes.error ||
      devicesTotalRes.error ||
      devicesActiveRes.error ||
      openMaintenanceRes.error ||
      visitorsTodayRes.error ||
      alertsRes.error ||
      walletRes.error ||
      duesRes.error ||
      paymentsRes.error;

    if (firstErr) return res.status(500).json({ error: firstErr.message });

    const totalOutstanding =
      (duesRes.data as AmountRow[] | null)?.reduce((sum, d) => sum + (d.amount || 0), 0) || 0;

    const collectedThisMonth =
      (paymentsRes.data as AmountRow[] | null)?.reduce((sum, p) => sum + (p.amount || 0), 0) || 0;

    return res.json({
      estate_id: estateId,

      homes: homesRes.count || 0,

      // ✅ Both now provided (helps UI)
      devices_total: devicesTotalRes.count || 0,
      active_devices: devicesActiveRes.count || 0,

      open_maintenance: openMaintenanceRes.count || 0,
      visitors_today: visitorsTodayRes.count || 0,
      alerts: alertsRes.count || 0,

      wallet: {
        balance: walletRes.data?.balance || 0,
        outstanding_dues: totalOutstanding,
        collected_this_month: collectedThisMonth,
      },
    });
  } catch (error) {
    console.error("Facility overview error:", error);
    const { msg } = extractErr(error);
    return res.status(500).json({ error: msg || "Failed to load facility overview" });
  }
};
