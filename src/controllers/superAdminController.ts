import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";

function n(v: any, fallback: number, min: number, max: number) {
  const x = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, x));
}

async function countOf(table: string) {
  const { count } = await supabaseAdmin
    .from(table)
    .select("*", { count: "exact", head: true });
  return Number(count || 0);
}

async function safeList(table: string, columns: string, limit = 50) {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select(columns)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return data || [];
}

export async function getOverview(_req: Request, res: Response) {
  try {
    const [
      estates,
      homes,
      users,
      devices,
      cameras,
      wallets,
      walletTransactions,
      notifications,
      maintenanceRequests,
      communityPosts,
      messages,
    ] = await Promise.all([
      countOf("estates"),
      countOf("homes"),
      countOf("users"),
      countOf("devices"),
      countOf("facility_cameras"),
      countOf("wallets"),
      countOf("wallet_transactions"),
      countOf("notifications"),
      countOf("maintenance_requests"),
      countOf("community_posts"),
      countOf("dm_messages"),
    ]);

    return res.json({
      ok: true,
      metrics: {
        estates,
        homes,
        users,
        devices,
        cameras,
        wallets,
        walletTransactions,
        notifications,
        maintenanceRequests,
        communityPosts,
        messages,
      },
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to load super admin overview" });
  }
}

export async function listEstates(req: Request, res: Response) {
  try {
    const limit = n(req.query.limit, 50, 1, 200);
    const q = String(req.query.q || "").trim();

    let query = supabaseAdmin
      .from("estates")
      .select("id,name,address,type,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (q) query = query.or(`name.ilike.%${q}%,address.ilike.%${q}%`);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    const items = data || [];
    const estateIds = items.map((e: any) => String(e.id));

    const [homes, devices, users] = await Promise.all([
      estateIds.length
        ? supabaseAdmin.from("homes").select("id,estate_id").in("estate_id", estateIds).limit(5000)
        : Promise.resolve({ data: [] as any[] }),
      estateIds.length
        ? supabaseAdmin.from("devices").select("id,estate_id").in("estate_id", estateIds).limit(5000)
        : Promise.resolve({ data: [] as any[] }),
      estateIds.length
        ? supabaseAdmin.from("users").select("id,estate_id").in("estate_id", estateIds).limit(5000)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const h = new Map<string, number>();
    const d = new Map<string, number>();
    const u = new Map<string, number>();

    for (const x of homes.data || []) h.set(String((x as any).estate_id), (h.get(String((x as any).estate_id)) || 0) + 1);
    for (const x of devices.data || []) d.set(String((x as any).estate_id), (d.get(String((x as any).estate_id)) || 0) + 1);
    for (const x of users.data || []) u.set(String((x as any).estate_id), (u.get(String((x as any).estate_id)) || 0) + 1);

    return res.json({
      ok: true,
      items: items.map((e: any) => ({
        ...e,
        homes: h.get(String(e.id)) || 0,
        devices: d.get(String(e.id)) || 0,
        users: u.get(String(e.id)) || 0,
      })),
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to list estates" });
  }
}

export async function listHomes(req: Request, res: Response) {
  try {
    const limit = n(req.query.limit, 100, 1, 300);
    const q = String(req.query.q || "").trim();

    let query = supabaseAdmin
      .from("homes")
      .select("id,estate_id,name,unit,block,type,resident_id,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (q) query = query.or(`name.ilike.%${q}%,unit.ilike.%${q}%,block.ilike.%${q}%`);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    const items = data || [];
    const estateIds = Array.from(new Set(items.map((x: any) => String(x.estate_id)).filter(Boolean)));

    let estateNameById = new Map<string, string>();
    if (estateIds.length) {
      const { data: estates } = await supabaseAdmin
        .from("estates")
        .select("id,name")
        .in("id", estateIds);
      estateNameById = new Map((estates || []).map((e: any) => [String(e.id), String(e.name || "")]));
    }

    return res.json({
      ok: true,
      items: items.map((x: any) => ({
        ...x,
        estate_name: estateNameById.get(String(x.estate_id)) || null,
      })),
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to list homes" });
  }
}

export async function listDevices(req: Request, res: Response) {
  try {
    const limit = n(req.query.limit, 100, 1, 300);
    const q = String(req.query.q || "").trim();

    let query = supabaseAdmin
      .from("devices")
      .select("id,estate_id,home_id,room_id,name,type,adapter,vendor,status,bind_state,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (q) query = query.or(`name.ilike.%${q}%,type.ilike.%${q}%,adapter.ilike.%${q}%,vendor.ilike.%${q}%`);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, items: data || [] });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to list devices" });
  }
}

export async function listTransactions(req: Request, res: Response) {
  try {
    const limit = n(req.query.limit, 100, 1, 400);
    const q = String(req.query.q || "").trim().toLowerCase();

    const { data: tx, error } = await supabaseAdmin
      .from("wallet_transactions")
      .select("id,wallet_id,direction,type,amount,reference,status,metadata,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return res.status(500).json({ error: error.message });
    const items = tx || [];

    const walletIds = Array.from(new Set(items.map((x: any) => String(x.wallet_id)).filter(Boolean)));
    const { data: wallets } = walletIds.length
      ? await supabaseAdmin.from("wallets").select("id,user_id,currency").in("id", walletIds)
      : { data: [] as any[] };

    const walletById = new Map((wallets || []).map((w: any) => [String(w.id), w]));
    const userIds = Array.from(new Set((wallets || []).map((w: any) => String(w.user_id)).filter(Boolean)));
    const { data: users } = userIds.length
      ? await supabaseAdmin.from("users").select("id,email,full_name,estate_id").in("id", userIds)
      : { data: [] as any[] };
    const userById = new Map((users || []).map((u: any) => [String(u.id), u]));

    const out = items.map((t: any) => {
      const w = walletById.get(String(t.wallet_id));
      const u = w ? userById.get(String((w as any).user_id)) : null;
      return {
        ...t,
        currency: (w as any)?.currency || "NGN",
        user_id: (w as any)?.user_id || null,
        user_email: (u as any)?.email || null,
        user_name: (u as any)?.full_name || null,
        estate_id: (u as any)?.estate_id || null,
      };
    });

    const filtered = q
      ? out.filter((t: any) => {
          const hay = `${t.reference || ""} ${t.type || ""} ${t.status || ""} ${t.user_email || ""}`.toLowerCase();
          return hay.includes(q);
        })
      : out;

    return res.json({ ok: true, items: filtered });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to list transactions" });
  }
}

export async function listActivities(req: Request, res: Response) {
  try {
    const limit = n(req.query.limit, 120, 10, 300);

    const [notifications, maintenance, community, camera, messages] = await Promise.all([
      safeList("notifications", "id,estate_id,title,message,type,status,created_at", 60),
      safeList("maintenance_requests", "id,estate_id,title,status,priority,created_at", 40),
      safeList("community_posts", "id,estate_id,title,status,created_at", 40),
      safeList("camera_events", "id,estate_id,camera_id,event_type,confidence,message,created_at", 60),
      safeList("dm_messages", "id,estate_id,thread_id,sender_id,body,created_at", 60),
    ]);

    const events = [
      ...(notifications as any[]).map((x) => ({
        id: `noti:${x.id}`,
        estate_id: x.estate_id || null,
        channel: "notification",
        title: x.title || "Notification",
        detail: x.message || "",
        level: x.type || "system",
        created_at: x.created_at,
      })),
      ...(maintenance as any[]).map((x) => ({
        id: `maint:${x.id}`,
        estate_id: x.estate_id || null,
        channel: "maintenance",
        title: x.title || "Maintenance request",
        detail: `status=${x.status || "open"} priority=${x.priority || "medium"}`,
        level: "maintenance",
        created_at: x.created_at,
      })),
      ...(community as any[]).map((x) => ({
        id: `community:${x.id}`,
        estate_id: x.estate_id || null,
        channel: "community",
        title: x.title || "Community post",
        detail: `status=${x.status || "active"}`,
        level: "community",
        created_at: x.created_at,
      })),
      ...(camera as any[]).map((x) => ({
        id: `camera:${x.id}`,
        estate_id: x.estate_id || null,
        channel: "camera",
        title: String(x.event_type || "camera_event").replace(/_/g, " "),
        detail: x.message || "",
        level: "security",
        created_at: x.created_at,
      })),
      ...(messages as any[]).map((x) => ({
        id: `msg:${x.id}`,
        estate_id: x.estate_id || null,
        channel: "message",
        title: "Direct message",
        detail: String(x.body || "").slice(0, 120),
        level: "community",
        created_at: x.created_at,
      })),
    ]
      .sort((a, b) => {
        const ta = new Date(a.created_at || 0).getTime();
        const tb = new Date(b.created_at || 0).getTime();
        return tb - ta;
      })
      .slice(0, limit);

    return res.json({ ok: true, items: events });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to list activity feed" });
  }
}
