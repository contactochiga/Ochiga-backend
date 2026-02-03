// src/controllers/facilityOverview.controller.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";

type AuthenticatedRequest = Request & {
  user?: { id: string; estate_id?: string; role?: string };
};

// ---------------------------
// SAFE HELPERS
// ---------------------------
function msg(err: any) {
  return String(err?.message || err?.details || err?.hint || "");
}

function isMissingTable(err: any, table: string) {
  const m = msg(err).toLowerCase();
  // supabase/postgrest common patterns
  return (
    m.includes("could not find the") && m.includes("table") && m.includes(table.toLowerCase())
  ) || m.includes(`relation "${table.toLowerCase()}" does not exist`);
}

function isMissingColumn(err: any, column: string) {
  const m = msg(err).toLowerCase();
  // e.g. column "estate_id" of relation ... does not exist
  return m.includes(`column "${column.toLowerCase()}"`) && m.includes("does not exist");
}

function monthStartISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01T00:00:00.000Z`;
}

function dayBoundsISO(d = new Date()) {
  const yyyyMmDd = d.toISOString().split("T")[0];
  return {
    start: `${yyyyMmDd}T00:00:00.000Z`,
    end: `${yyyyMmDd}T23:59:59.999Z`,
    yyyyMmDd,
  };
}

// ---------------------------
// CONTROLLER
// ---------------------------
export const getFacilityOverview = async (req: AuthenticatedRequest, res: Response) => {
  try {
    let estateId = req.user?.estate_id;

    // ✅ membership fallback
    if (!estateId && req.user?.id) {
      const { data: mem, error: memErr } = await supabaseAdmin
        .from("estate_memberships")
        .select("estate_id")
        .eq("user_id", req.user.id)
        .eq("status", "active")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (memErr) {
        // Don’t crash overview for membership read errors — but report it
        console.error("overview: membership fallback error:", memErr.message);
      }

      estateId = mem?.estate_id;
    }

    if (!estateId) {
      return res.status(400).json({
        error: "No estate linked. Create or join an estate.",
      });
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

    const { start: todayStart, end: todayEnd } = dayBoundsISO(new Date());

    // ✅ VISITORS TODAY (use visitor_access – that's your real table now)
    let visitorsToday = 0;
    {
      const vRes = await supabaseAdmin
        .from("visitor_access")
        .select("*", { count: "exact", head: true })
        .eq("estate_id", estateId)
        .gte("created_at", todayStart)
        .lte("created_at", todayEnd);

      if (!vRes.error) {
        visitorsToday = vRes.count || 0;
      } else if (!isMissingTable(vRes.error, "visitor_access")) {
        // only throw if it’s a real error
        throw vRes.error;
      }
    }

    // ✅ ALERTS (support both "read:boolean" or "status: unread/read")
    let alerts = 0;
    {
      // First try: read=false
      const a1 = await supabaseAdmin
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("estate_id", estateId)
        .eq("read", false);

      if (!a1.error) {
        alerts = a1.count || 0;
      } else if (isMissingColumn(a1.error, "read")) {
        // fallback: status='unread'
        const a2 = await supabaseAdmin
          .from("notifications")
          .select("*", { count: "exact", head: true })
          .eq("estate_id", estateId)
          .eq("status", "unread");

        if (!a2.error) alerts = a2.count || 0;
        else if (!isMissingTable(a2.error, "notifications")) throw a2.error;
      } else if (!isMissingTable(a1.error, "notifications")) {
        throw a1.error;
      }
    }

    // ---------------------------
    // WALLET (estate-scoped, safe)
    // ---------------------------
    let walletBalance = 0;
    let outstanding = 0; // keep 0 until dues/invoices table is finalized
    let collected = 0;

    // 1) SUM wallets.balance where estate_id = current estate
    {
      const wRes = await supabaseAdmin
        .from("wallets")
        .select("balance")
        .eq("estate_id", estateId);

      if (!wRes.error) {
        const rows = (wRes.data || []) as Array<{ balance: any }>;
        walletBalance = rows.reduce((s, r) => s + Number(r.balance || 0), 0);
      } else if (!isMissingTable(wRes.error, "wallets")) {
        // If wallets exists but estate_id missing, keep safe
        if (!isMissingColumn(wRes.error, "estate_id")) throw wRes.error;
      }
    }

    // 2) SUM wallet_transactions.amount for credits this month (status successful)
    {
      const startOfMonth = monthStartISO(new Date());

      const tRes = await supabaseAdmin
        .from("wallet_transactions")
        .select("amount,type,status,created_at")
        .eq("estate_id", estateId)
        .gte("created_at", startOfMonth);

      if (!tRes.error) {
        const rows = (tRes.data || []) as Array<{
          amount: any;
          type?: string | null;
          status?: string | null;
        }>;

        collected = rows.reduce((s, r) => {
          const type = String(r.type || "").toLowerCase();
          const status = String(r.status || "").toLowerCase();

          const isCredit = type === "credit" || type === "fund" || type === "topup";
          const isOk = !status || status === "successful" || status === "success" || status === "completed";

          if (isCredit && isOk) return s + Number(r.amount || 0);
          return s;
        }, 0);
      } else if (!isMissingTable(tRes.error, "wallet_transactions")) {
        if (!isMissingColumn(tRes.error, "estate_id")) throw tRes.error;
      }
    }

    // ---------------------------
    // FINAL RESPONSE
    // ---------------------------
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
  } catch (err) {
    console.error("Facility overview error:", err);
    return res.status(500).json({
      error: "Failed to load facility overview",
    });
  }
};
