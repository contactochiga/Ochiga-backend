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
  return (
    cleanStr(d?.vendor) ||
    cleanStr(d?.adapter) ||
    "tuya"
  ) as string;
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

  // try find existing room by name for this home
  const { data: found, error: findErr } = await supabaseAdmin
    .from("rooms")
    .select("id,name")
    .eq("home_id", opts.home_id)
    .ilike("name", roomName)
    .maybeSingle();

  if (findErr) {
    // if rooms table isn't available, just fail softly and assign without room_id
    console.warn("resolveRoomId find room error:", findErr.message);
    return null;
  }

  if (found?.id) return found.id;

  // create room if not found
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
 *
 * Accepts:
 *  - { deviceIds: string[], room?: string, room_id?: uuid }
 *  - { devices: any[], room?: string, room_id?: uuid }
 *
 * Writes ONLY columns that exist in public.devices:
 * id, estate_id, home_id, room_id, name, type, external_id,
 * status, metadata, lat, lng, icon, vendor, created_at, updated_at
 */
export async function assignDevices(req: Request, res: Response) {
  try {
    const user: any = (req as any).user;
    if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

    if (!user.estate_id) return res.status(400).json({ error: "User has no estate" });
    if (!user.home_id) return res.status(400).json({ error: "User has no home" });

    const incomingDevices = Array.isArray(req.body?.devices) ? req.body.devices : null;
    const deviceIds = Array.isArray(req.body?.deviceIds) ? req.body.deviceIds : null;

    if ((!incomingDevices || incomingDevices.length === 0) && (!deviceIds || deviceIds.length === 0)) {
      return res.status(400).json({ error: "Provide devices[] or deviceIds[]" });
    }

    const room_id = await resolveRoomId({
      estate_id: user.estate_id,
      home_id: user.home_id,
      room_id: req.body?.room_id,
      room: req.body?.room, // "Bedroom"
    });

    // build normalized payload list
    const list = incomingDevices ?? deviceIds!.map((id: string) => ({ external_id: id }));

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
        const lat = d?.lat ?? d?.metadata?.lat ?? null;
        const lng = d?.lng ?? d?.metadata?.lng ?? null;

        return {
          estate_id: user.estate_id,
          home_id: user.home_id,
          room_id: room_id, // may be null if no room selected or room creation fails
          name,
          type,
          external_id,
          status,
          vendor,
          icon,
          lat: lat === null ? null : Number(lat),
          lng: lng === null ? null : Number(lng),
          metadata: d?.metadata ?? d, // ✅ correct json column name
          updated_at: new Date().toISOString(),
        };
      })
      .filter(Boolean) as any[];

    if (rows.length === 0) {
      return res.status(400).json({ error: "No valid devices found to assign" });
    }

    // ✅ upsert by vendor + external_id (assumes you created a unique constraint/index)
    const { data, error } = await supabaseAdmin
      .from("devices")
      .upsert(rows, { onConflict: "vendor,external_id" })
      .select("*");

    if (error) {
      console.error("assignDevices upsert error:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      ok: true,
      room_id,
      count: data?.length || 0,
      devices: data || [],
    });
  } catch (e: any) {
    console.error("assignDevices error:", e);
    return res.status(500).json({ error: e?.message || "Assign failed" });
  }
}
