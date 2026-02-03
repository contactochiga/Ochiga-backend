// src/controllers/facilityOverview.controller.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";

type AuthenticatedRequest = Request & {
  user?: { id: string; estate_id?: string; role?: string };
};

type AmountRow = { amount: number };

function isMissingTable(err: any, table: string) {
  const msg = String(err?.message || "");
  return (
    msg.toLowerCase().includes("could not find the table") &&
    msg.toLowerCase().includes(table.toLowerCase())
  );
}

export const getFacilityOverview = async (req: AuthenticatedRequest, res: Response) => {
  try {
    let estateId = req.user?.estate_id;

    // ✅ membership fallback
    if (!estateId && req.user?.id) {
      const { data: mem } = await supabaseAdmin
        .from("estate_memberships")
        .select("estate_id")
        .eq("user_id", req.user.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();

      estateId = mem?.estate_id;
    }

    if (!estateId) {
      return res.status(400).json({ error: "No estate linked. Create or join an estate." });
    }

    // ---------------------------
    // CORE OPS (must NEVER fail)
    // ---------------------------
    const { count: homes } = await supabaseAdmin
      .from("homes")
      .select("*", { count: "exact", head: true })
      .eq("estate_id", estateId);

    const { count: activeDevices } = await supabaseAdmin
      .from("devices")
      .select("*", { count: "exact", head: true })
      .eq("estate_id", estateId);

    const { count: openMaintenance } = await supabaseAdmin
      .from("maintenance_requests")
      .select("*", { count: "exact", head: true })
      .eq("estate_id", estateId)
      .in("status", ["open", "in_progress"]);

    // ✅ IMPORTANT: your real visitor system is visitor_access (not visitors)
    const today = new Date().toISOString().split("T")[0];
    const { count: visitorsToday } = await supabaseAdmin
      .from("visitor_access")
      .select("*", { count: "exact", head: true })
      .eq("estate_id", estateId)
      .gte("created_at", `${today}T00:00:00`)
      .lte("created_at", `${today}T23:59:59`);

    const { count: alerts } = await supabaseAdmin
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("estate_id", estateId)
      .eq("read", false);

    // ---------------------------
    // WALLET (OPTIONAL – SAFE)
    // ---------------------------
    let walletBalance = 0;
    let outstanding = 0;
    let collected = 0;

    // estate_wallets (optional)
    const walletRes = await supabaseAdmin
      .from("estate_wallets")
      .select("balance")
      .eq("estate_id", estateId)
      .maybeSingle();

    if (!walletRes.error) {
      walletBalance = Number(walletRes.data?.balance || 0);
    } else if (!isMissingTable(walletRes.error, "estate_wallets")) {
      console.error("estate_wallets error:", walletRes.error);
    }

    // dues (optional)
    const duesRes = await supabaseAdmin
      .from("dues")
      .select("amount")
      .eq("estate_id", estateId)
      .eq("status", "unpaid");

    if (!duesRes.error && duesRes.data) {
      outstanding = duesRes.data.reduce((s: number, d: AmountRow) => s + Number(d.amount || 0), 0);
    } else if (duesRes.error && !isMissingTable(duesRes.error, "dues")) {
      console.error("dues error:", duesRes.error);
    }

    // payments (optional)
    const paymentsRes = await supabaseAdmin
      .from("payments")
      .select("amount")
      .eq("estate_id", estateId)
      .gte("created_at", `${today.slice(0, 7)}-01`);

    if (!paymentsRes.error && paymentsRes.data) {
      collected = paymentsRes.data.reduce((s: number, p: AmountRow) => s + Number(p.amount || 0), 0);
    } else if (paymentsRes.error && !isMissingTable(paymentsRes.error, "payments")) {
      console.error("payments error:", paymentsRes.error);
    }

    return res.json({
      estate_id: estateId,
      homes: homes || 0,
      active_devices: activeDevices || 0,
      open_maintenance: openMaintenance || 0,
      visitors_today: visitorsToday || 0,
      alerts: alerts || 0,
      wallet: {
        balance: walletBalance,
        outstanding_dues: outstanding,
        collected_this_month: collected,
      },
    });
  } catch (err: any) {
    console.error("Facility overview error:", err);
    return res.status(500).json({ error: "Failed to load facility overview" });
  }
};
