// src/controllers/deviceDiscoveryController.ts
import { Request, Response } from "express";
import { AdapterContext } from "../device/adapters/types";
import { adapterRegistry } from "../device/adapters/registry";
import { initAdaptersOnce } from "../device/adapters/initAdapters";
import { supabaseAdmin } from "../supabase/supabaseClient";

function cleanStr(v: any) {
  const s = String(v ?? "").trim();
  return s.length ? s : "";
}

async function resolveUserTuyaUid(userId: string): Promise<string | null> {
  const fromUsers = await supabaseAdmin
    .from("users")
    .select("tuya_uid")
    .eq("id", userId)
    .maybeSingle();

  if (!fromUsers.error) {
    const uid = cleanStr((fromUsers.data as any)?.tuya_uid);
    if (uid) return uid;
  }

  const fromInteg = await supabaseAdmin
    .from("user_integrations")
    .select("external_user_id")
    .eq("user_id", userId)
    .eq("provider", "tuya")
    .maybeSingle();

  if (!fromInteg.error) {
    const uid = cleanStr((fromInteg.data as any)?.external_user_id);
    if (uid) return uid;
  }

  return null;
}

/**
 * GET /devices/discover?adapter=tuya
 * ✅ adapter defaults to "tuya" if not provided
 *
 * ✅ Filters out devices already bound in this estate (so discovery only shows "new")
 */
export async function discoverDevices(req: Request, res: Response) {
  // ✅ HARD NO-CACHE (prevents 304 + empty body)
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");

  res.removeHeader("ETag");
  res.removeHeader("Last-Modified");

  try {
    initAdaptersOnce();

    const user: any = (req as any).user;

    const adapterName = cleanStr(req.query.adapter || "tuya").toLowerCase() || "tuya";

    if (!user?.estate_id) {
      return res.status(200).json({
        adapter: adapterName,
        count: 0,
        devices: [],
        ts: Date.now(),
        filteredOut: 0,
        warning: "User has no estate",
      });
    }

    // ✅ Security: user must discover with their own linked Tuya identity.
    // Optional admin override only for debugging.
    let tuyaUid = await resolveUserTuyaUid(String(user.id));
    if (!tuyaUid && user?.role === "admin") {
      tuyaUid = cleanStr(req.query.uid);
    }

    const context: AdapterContext = {
      estateId: user.estate_id,
      homeId: user.home_id,
      userId: user.id,
      credentials: {
        apiKey: process.env.TUYA_ACCESS_ID,
        apiSecret: process.env.TUYA_ACCESS_SECRET,
        tuyaUid,
        cidr: req.query.cidr ? String(req.query.cidr) : undefined,
        timeoutMs: req.query.timeoutMs ? Number(req.query.timeoutMs) : undefined,

        onvifUser: req.query.onvifUser ? String(req.query.onvifUser) : undefined,
        onvifPass: req.query.onvifPass ? String(req.query.onvifPass) : undefined,
        username: req.query.onvifUser ? String(req.query.onvifUser) : undefined,
        password: req.query.onvifPass ? String(req.query.onvifPass) : undefined,
      } as any,
    };

    const adapter = adapterRegistry.get(adapterName);

    if (!adapter) {
      return res.status(400).json({
        error: `Unsupported adapter: ${adapterName}`,
        supported: adapterRegistry.list().map((a) => a.name),
      });
    }

    if (adapterName === "tuya" && !tuyaUid) {
      return res.status(200).json({
        adapter: adapterName,
        count: 0,
        devices: [],
        ts: Date.now(),
        filteredOut: 0,
        warning:
          "Tuya not linked for this account. Save your Tuya UID in /me/integrations/tuya first.",
      });
    }

    const devices = await adapter.discover(context);

    // ✅ FILTER OUT ALREADY-BOUND DEVICES
    const extIds = devices.map((d: any) => String(d?.externalId || "").trim()).filter(Boolean);

    if (extIds.length) {
      const { data: existing, error: exErr } = await supabaseAdmin
        .from("devices")
        .select("external_id,home_id")
        .eq("estate_id", user.estate_id)
        .eq("vendor", adapterName) // vendor is "tuya" for tuya adapter
        .in("external_id", extIds);

      if (exErr) {
        console.warn("discoverDevices existing lookup error:", exErr.message);
      } else {
        const existingSet = new Set((existing ?? []).filter((x: any) => Boolean(x.home_id)).map((x: any) => String(x.external_id)));
        const filtered = devices.filter((d: any) => !existingSet.has(String(d.externalId)));
        return res.status(200).json({
          adapter: adapterName,
          count: filtered.length,
          devices: filtered,
          ts: Date.now(),
          filteredOut: existingSet.size,
        });
      }
    }

    return res.status(200).json({
      adapter: adapterName,
      count: devices.length,
      devices,
      ts: Date.now(),
      filteredOut: 0,
    });
  } catch (err: any) {
    console.error("discoverDevices error:", err);
    return res.status(500).json({ error: err?.message || "Discovery failed" });
  }
}
