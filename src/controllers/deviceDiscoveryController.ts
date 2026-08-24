// src/controllers/deviceDiscoveryController.ts
import { Request, Response } from "express";
import { AdapterContext } from "../device/adapters/types";
import { adapterRegistry } from "../device/adapters/registry";
import { initAdaptersOnce } from "../device/adapters/initAdapters";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { getHomeProviderConnection, getLegacyProviderAccountId } from "../services/providerConnectionService";

function cleanStr(v: any) {
  const s = String(v ?? "").trim();
  return s.length ? s : "";
}

async function resolveUserTuyaUid(userId: string): Promise<string | null> {
  return getLegacyProviderAccountId(userId, "tuya");
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
    const actor = {
      ...user,
      estate_id: (req as any).oisContext?.estate_id || user.estate_id,
      home_id: (req as any).oisContext?.home_id || user.home_id,
    };
    const providerConnection = await getHomeProviderConnection(actor, "tuya").catch(() => null);
    let tuyaUid = cleanStr(providerConnection?.provider_account_id) || await resolveUserTuyaUid(String(user.id));
    if (!tuyaUid && user?.role === "admin") {
      tuyaUid = cleanStr(req.query.uid);
    }

    const context: AdapterContext = {
      estateId: actor.estate_id,
      homeId: actor.home_id,
      userId: user.id,
      credentials: {
        apiKey: process.env.TUYA_ACCESS_ID,
        apiSecret: process.env.TUYA_ACCESS_SECRET,
        tuyaUid,
        timeoutMs: req.query.timeoutMs ? Number(req.query.timeoutMs) : undefined,
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
        .eq("estate_id", actor.estate_id)
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
