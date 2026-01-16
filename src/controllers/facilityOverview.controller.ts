// src/controllers/facilityOverview.controller.ts
import { supabase } from "../lib/supabaseClient";

export const getFacilityOverview = async (req, res) => {
  try {
    const estateId = req.user.estate_id;

    if (!estateId) {
      return res.status(400).json({ error: "Estate not linked to user" });
    }

    // 1. Total Homes
    const { count: totalHomes } = await supabase
      .from("homes")
      .select("*", { count: "exact", head: true })
      .eq("estate_id", estateId);

    // 2. Active Devices
    const { count: activeDevices } = await supabase
      .from("devices")
      .select("*", { count: "exact", head: true })
      .eq("estate_id", estateId)
      .eq("status", "active");

    // 3. Open Maintenance
    const { count: openMaintenance } = await supabase
      .from("maintenance_requests")
      .select("*", { count: "exact", head: true })
      .eq("estate_id", estateId)
      .in("status", ["open", "in_progress"]);

    // 4. Visitors Today
    const today = new Date().toISOString().split("T")[0];

    const { count: visitorsToday } = await supabase
      .from("visitors")
      .select("*", { count: "exact", head: true })
      .eq("estate_id", estateId)
      .gte("created_at", `${today}T00:00:00`)
      .lte("created_at", `${today}T23:59:59`);

    // 5. Alerts (Unread)
    const { count: alerts } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("estate_id", estateId)
      .eq("read", false);

    // 6. Wallet Summary
    const { data: wallet } = await supabase
      .from("estate_wallets")
      .select("balance")
      .eq("estate_id", estateId)
      .single();

    const { data: dues } = await supabase
      .from("dues")
      .select("amount")
      .eq("estate_id", estateId)
      .eq("status", "unpaid");

    const { data: payments } = await supabase
      .from("payments")
      .select("amount")
      .eq("estate_id", estateId)
      .gte("created_at", `${today.slice(0, 7)}-01`);

    const totalOutstanding = dues?.reduce((sum, d) => sum + d.amount, 0) || 0;
    const collectedThisMonth =
      payments?.reduce((sum, p) => sum + p.amount, 0) || 0;

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
        collected_this_month: collectedThisMonth
      }
    });
  } catch (error) {
    console.error("Facility overview error:", error);
    res.status(500).json({ error: "Failed to load facility overview" });
  }
};
