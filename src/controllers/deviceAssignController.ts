// src/controllers/deviceAssignController.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";

function cleanStr(v: any) {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

function pickExternalId(d: any): string | null {
  return (
    cleanStr(d?.external_id) ||
    cleanStr(d?.externalId) ||
    cleanStr(d?.dev_id) ||
    cleanStr(d?.device_id) ||
    cleanStr(d?.id) ||
    cleanStr(d?.uuid) ||
    null
  );
}

function pickVendor(d: any): string {
  return (cleanStr(d?.vendor) || cleanStr(d?.adapter) || "tuya") as string;
}

function numOrNull(v: any) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolve room_id from:
 *  - req.body.room_id (uuid) OR
 *  - req.body.room (name like "Bedroom")
 *
 * If a room name is provided and doesn't exist yet, we create it.
 */
async function resolveRoomId(opts: {
  estate_id: string;
  home_id: string;
  room_id?: any;
  room?: any;
}): Promise<string | null> {
  const roomId = cleanStr(opts.room_id);
  if (roomId) return roomId;

  const roomName = cleanStr(opts.room);
  if (!roomName) return null;

  const { data: found, error: findErr } = await supabaseAdmin
    .from("rooms")
    .select("id,name")
    .eq("home_id", opts.home_id)
    .ilike("name", roomName)
    .maybeSingle();

  if (findErr) {
    console.warn("resolveRoomId find room error:", findErr.message);
    return null;
  }

  if (found?.id) return found.id;

  const { data: created, error: createErr } = await supabaseAdmin
    .from("rooms")
    .insert([
      {
        estate_id: opts.estate_id,
        home_id: opts.home_id,
        name: roomName,
        type: "custom",
      },
    ])
    .select("id")
    .single();

  if (createErr) {
    console.warn("resolveRoomId create room error:", createErr.message);
    return null;
  }

  return created?.id ?? null;
}

/**
 * POST /devices/assign
 */
export async function assignDevices(req: Request, res: Response) {
  try {
    const user: any = (req as any).user;
    if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

    if (!user.estate_id) return res.status(400).json({ error: "User has no estate" });
    if (!user.home_id) return res.status(400).json({ error: "User has no home" });

    const incomingDevices = Array.isArray((req.body as any)?.devices)
      ? (req.body as any).devices
      : null;

    const deviceIds = Array.isArray((req.body as any)?.deviceIds)
      ? (req.body as any).deviceIds
      : null;

    if ((!incomingDevices || incomingDevices.length === 0) && (!deviceIds || deviceIds.length === 0)) {
      return res.status(400).json({ error: "Provide devices[] or deviceIds[]" });
    }

    const room_id = await resolveRoomId({
      estate_id: user.estate_id,
      home_id: user.home_id,
      room_id: (req.body as any)?.room_id,
      room: (req.body as any)?.room,
    });

    const list = incomingDevices ?? deviceIds!.map((id: string) => ({ external_id: id }));
    const nowIso = new Date().toISOString();

    const rows = list
      .map((d: any) => {
        const external_id = pickExternalId(d);
        if (!external_id) return null;

        const vendor = pickVendor(d);

        const name =
          cleanStr(d?.name) ||
          cleanStr(d?.device_name) ||
          cleanStr(d?.product_name) ||
          "Device";

        const type =
          cleanStr(d?.type) ||
          cleanStr(d?.category) ||
          "device";

        const status =
          cleanStr(d?.status) ||
          (typeof d?.online === "boolean" ? (d.online ? "online" : "offline") : null) ||
          "assigned";

        const icon = cleanStr(d?.icon);

        const lat = numOrNull(d?.lat ?? d?.metadata?.lat);
        const lng = numOrNull(d?.lng ?? d?.metadata?.lng);

        return {
          estate_id: user.estate_id,
          home_id: user.home_id,
          room_id,
          name,
          type,
          external_id,
          status,
          vendor,
          icon,
          lat,
          lng,
          metadata: d?.metadata ?? d,
          updated_at: nowIso,
        };
      })
      .filter(Boolean) as any[];

    if (rows.length === 0) {
      return res.status(400).json({ error: "No valid devices found to assign" });
    }

    // 🔒 Guard: do not allow rebinding devices already owned by another home/estate.
    const externalIds = Array.from(new Set(rows.map((r) => String(r.external_id))));
    const vendors = Array.from(new Set(rows.map((r) => String(r.vendor))));
    const { data: existingRows, error: existingErr } = await supabaseAdmin
      .from("devices")
      .select("id,vendor,external_id,estate_id,home_id,metadata,adapter,provider")
      .in("vendor", vendors)
      .in("external_id", externalIds);

    if (existingErr) {
      return res.status(500).json({ error: existingErr.message });
    }

    const conflicts = (existingRows || []).filter((d: any) => {
      const sameEstate = String(d?.estate_id || "") === String(user.estate_id || "");
      const sameHome = String(d?.home_id || "") === String(user.home_id || "");
      const isUnassigned = !d?.home_id;
      return !(sameEstate && (sameHome || isUnassigned));
    });

    if (conflicts.length) {
      return res.status(409).json({
        error: "Some devices are already linked to another home/account",
        conflicts: conflicts.map((c: any) => ({
          id: c.id,
          vendor: c.vendor,
          external_id: c.external_id,
        })),
      });
    }

    const existingByIdentity = new Map(
      (existingRows || []).map((row: any) => [`${String(row.vendor)}:${String(row.external_id)}`, row])
    );
    const assigned: any[] = [];
    const pendingInsert: any[] = [];
    for (const row of rows) {
      const existing = existingByIdentity.get(`${String(row.vendor)}:${String(row.external_id)}`);
      const next = {
        ...row,
        adapter: existing?.adapter || row.vendor,
        provider: existing?.provider || row.vendor,
        bind_state: room_id ? "room_bound" : "home_bound",
        sync_state: "assigned",
        metadata: { ...(existing?.metadata || {}), ...(row.metadata || {}) },
      };
      if (!existing?.id) {
        pendingInsert.push(next);
        continue;
      }
      const { data, error } = await supabaseAdmin.from("devices").update(next).eq("id", existing.id).select("*").single();
      if (error) return res.status(500).json({ error: error.message });
      assigned.push(data);
    }
    if (pendingInsert.length) {
      const { data, error } = await supabaseAdmin.from("devices").upsert(pendingInsert, { onConflict: "vendor,external_id" }).select("*");
      if (error) {
        console.error("assignDevices upsert error:", error);
        return res.status(500).json({ error: error.message });
      }
      assigned.push(...(data || []));
    }

    return res.json({
      ok: true,
      room_id,
      count: assigned.length,
      devices: assigned,
    });
  } catch (e: any) {
    console.error("assignDevices error:", e);
    return res.status(500).json({ error: e?.message || "Assign failed" });
  }
}
