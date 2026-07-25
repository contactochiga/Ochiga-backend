import type { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import {
  createUnsupportedCredentialRecord,
  getSmartAccessProfileForDevice,
  listSmartAccessCredentials,
  listSmartAccessRecords,
} from "../services/smartAccessCapabilityService";
import { logger } from "../observability/logger";

function clean(value: any) {
  return String(value ?? "").trim();
}

async function resolveScopedDevice(req: Request) {
  const deviceId = clean(req.params.deviceId);
  const user = (req as any).user || {};
  const context = (req as any).oisContext || {};
  const estateId = clean(context.estate_id || user.estate_id);
  const homeId = clean(context.home_id || user.home_id);
  if (!deviceId) {
    const error: any = new Error("deviceId is required");
    error.statusCode = 400;
    throw error;
  }
  if (!estateId || !homeId) {
    const error: any = new Error("Active home context is required.");
    error.statusCode = 400;
    throw error;
  }
  const { data, error } = await supabaseAdmin
    .from("devices")
    .select("*")
    .or(`id.eq.${deviceId},external_id.eq.${deviceId}`)
    .eq("estate_id", estateId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) {
    const notFound: any = new Error("Smart access device not found.");
    notFound.statusCode = 404;
    throw notFound;
  }
  if (clean((data as any).home_id) !== homeId) {
    const forbidden: any = new Error("This device is outside the active home.");
    forbidden.statusCode = 403;
    throw forbidden;
  }
  return data;
}

function safeError(res: Response, error: any, fallback: string) {
  const statusCode = Number(error?.statusCode || error?.status || 500);
  return res.status(statusCode >= 400 && statusCode < 600 ? statusCode : 500).json({
    ok: false,
    code: error?.code || (statusCode === 403 ? "forbidden" : statusCode === 404 ? "not_found" : "smart_access_failed"),
    error: error?.message || fallback,
  });
}

export async function getSmartAccessDevice(req: Request, res: Response) {
  try {
    const device = await resolveScopedDevice(req);
    const refresh = String(req.query.refresh || "").toLowerCase() === "true";
    const profile = await getSmartAccessProfileForDevice(device, { refresh, source: refresh ? "api_refresh" : "api_read" });
    const [records, credentials] = await Promise.all([
      listSmartAccessRecords(device, 5).catch(() => []),
      listSmartAccessCredentials(device).catch(() => []),
    ]);
    return res.json({
      ok: true,
      device: {
        id: device.id,
        name: device.name,
        estate_id: device.estate_id,
        home_id: device.home_id,
        room_id: device.room_id || null,
        provider: device.provider || device.vendor || device.adapter || null,
        provider_category: profile.provider_category,
        provider_product_id: profile.provider_product_id,
        provider_model: profile.provider_model,
      },
      profile,
      records,
      credentials,
    });
  } catch (error: any) {
    logger.warn("smart_access_read_failed", {
      device_id: req.params.deviceId || null,
      actor_id: (req as any).user?.id || null,
      estate_id: (req as any).oisContext?.estate_id || null,
      home_id: (req as any).oisContext?.home_id || null,
      error: error?.message || "smart_access_read_failed",
    });
    return safeError(res, error, "Smart access details are temporarily unavailable.");
  }
}

export async function refreshSmartAccessDevice(req: Request, res: Response) {
  try {
    const device = await resolveScopedDevice(req);
    const profile = await getSmartAccessProfileForDevice(device, { refresh: true, source: "manual_refresh" });
    return res.json({ ok: true, profile });
  } catch (error: any) {
    return safeError(res, error, "Smart access refresh is temporarily unavailable.");
  }
}

export async function getSmartAccessRecords(req: Request, res: Response) {
  try {
    const device = await resolveScopedDevice(req);
    const records = await listSmartAccessRecords(device, Number(req.query.limit || 30));
    return res.json({ ok: true, records });
  } catch (error: any) {
    return safeError(res, error, "Smart access history is temporarily unavailable.");
  }
}

export async function getSmartAccessCredentials(req: Request, res: Response) {
  try {
    const device = await resolveScopedDevice(req);
    const credentials = await listSmartAccessCredentials(device);
    return res.json({ ok: true, credentials });
  } catch (error: any) {
    return safeError(res, error, "Smart access credentials are temporarily unavailable.");
  }
}

export async function createSmartAccessCredential(req: Request, res: Response) {
  try {
    const device = await resolveScopedDevice(req);
    const credential = await createUnsupportedCredentialRecord(device, req.body || {}, (req as any).user?.id || null);
    return res.status(202).json({
      ok: true,
      status: credential?.status || "setup_incomplete",
      credential,
      message: "Access code setup needs provider confirmation before it can be used.",
    });
  } catch (error: any) {
    return safeError(res, error, "This lock cannot create that access credential.");
  }
}

export async function requestSmartAccessMediaSession(req: Request, res: Response) {
  try {
    const device = await resolveScopedDevice(req);
    const profile = await getSmartAccessProfileForDevice(device);
    if (profile.capabilities?.media?.live_view?.status !== "supported") {
      return res.status(400).json({
        ok: false,
        code: "smart_access_media_unsupported",
        error: "This lock does not expose a camera or live-view session.",
      });
    }
    return res.status(503).json({
      ok: false,
      code: "smart_access_media_provider_unavailable",
      error: "Live view is temporarily unavailable for this device.",
    });
  } catch (error: any) {
    return safeError(res, error, "Smart access media is temporarily unavailable.");
  }
}
