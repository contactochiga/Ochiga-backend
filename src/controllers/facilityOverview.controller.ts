// src/controllers/facilityOverview.controller.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";

// ---------------------------
// TYPES
// ---------------------------
type AuthenticatedRequest = Request & {
  user?: {
    id: string;
    estate_id?: string;
    role?: string;
  };
};

type AmountRow = {
  amount: number;
};

// ---------------------------
// CONTROLLER
// ---------------------------
export const getFacilityOverview = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const estateId = req.user?.estate_id;

    if (!estateId) {
      return res.status(400).json({ error: "Estate not linked to user" });
    }

    // 1. Total Homes
    const { count: totalHomes } = await supabaseAdmin
      .from("homes")
      .select("*", { count: "exact", head: true })
      .eq("estate_id", estateId);

    // 2. Active Devices
    const { count: activeDevices } = await supabaseAdmin
      .from("devices")
      .select("*", { count: "exact", head: true })
      .eq("estate_id", estateId)
      .eq("status", "active");

    // 3. Open Maintenance
    const { count: openMaintenance } = await supabaseAdmin
      .from("maintenance_requests")
      .select("*", { count: "exact", head: true })
      .eq("estate_id", estateId)
      .in("status", ["open", "in_progress"]);

    // 4. Visitors Today
    const today = new Date().toISOString().split("T")[0];

    const { count: visitorsToday } = await supabaseAdmin
      .from("visitors")
      .select("*", { count: "exact", head: true })
      .eq("estate_id", estateId)
      .gte("created_at", `${today}T00:00:00`)
      .lte("created_at", `${today}T23:59:59`);

    // 5. Alerts (Unread)
    const { count: alerts } = await supabaseAdmin
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("estate_id", estateId)
      .eq("read", false);

    // 6. Wallet Summary
    const { data: wallet } = await supabaseAdmin
      .from("estate_wallets")
      .select("balance")
      .eq("estate_id", estateId)
      .single();

    const { data: dues } = await supabaseAdmin
      .from("dues")
      .select("amount")
      .eq("estate_id", estateId)
      .eq("status", "unpaid");

    const { data: payments } = await supabaseAdmin
      .from("payments")
      .select("amount")
      .eq("estate_id", estateId)
      .gte("created_at", `${today.slice(0, 7)}-01`);

    const totalOutstanding =
      (dues as AmountRow[] | null)?.reduce(
        (sum: number, d: AmountRow) => sum + d.amount,
        0
      ) || 0;

    const collectedThisMonth =
      (payments as AmountRow[] | null)?.reduce(
        (sum: number, p: AmountRow) => sum + p.amount,
        0
      ) || 0;

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
  } catch (error) {
    console.error("Facility overview error:", error);
    return res
      .status(500)
      .json({ error: "Failed to load facility overview" });
  }
};
