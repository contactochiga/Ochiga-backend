// src/controllers/deviceCommandController.ts
import { Request, Response } from "express";
import { handleSignal } from "../core/control-plane";
import { SIGNAL_SCHEMA_VERSION } from "../core/control-plane/contracts";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { adapterRegistry } from "../device/adapters/registry";
import { initAdaptersOnce } from "../device/adapters/initAdapters";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function normalizeCommand(input: any): Record<string, any> {
  // ✅ allow command to be:
  // { switch: true } OR { commands: [{code,value}] } OR { on: true }
  const c = input ?? {};

  // If they mistakenly send { commands: [...] } from frontend
  if (Array.isArray(c.commands)) {
    const out: Record<string, any> = {};
    for (const item of c.commands) {
      if (item?.code) out[String(item.code)] = item.value;
    }
    return out;
  }

  // Common aliases → Tuya DP codes (best-effort)
  if (typeof c.on === "boolean" && c.switch === undefined) return { switch: c.on };
  if (typeof c.power === "boolean" && c.switch === undefined) return { switch: c.power };

  return c;
}

export async function requestDeviceCommand(req: Request, res: Response) {
  try {
    const rawId = String(req.params.deviceId || "").trim();
    const command = req.body?.command;

    if (!rawId) return res.status(400).json({ error: "deviceId is required" });
    if (!command) return res.status(400).json({ error: "command is required" });

    const user = (req as any).user;
    if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

    // 🔥 Normalize device reference: allow UUID or external_id
    let deviceRow: any = null;

    if (isUuid(rawId)) {
      let q = supabaseAdmin
        .from("devices")
        .select("id, vendor, external_id, estate_id, home_id, room_id")
        .eq("id", rawId)
        .eq("estate_id", user.estate_id);

      if (user.home_id) q = q.eq("home_id", user.home_id);

      const { data } = await q.maybeSingle();
      deviceRow = data;
    } else {
      let q = supabaseAdmin
        .from("devices")
        .select("id, vendor, external_id, estate_id, home_id, room_id")
        .eq("external_id", rawId)
        .eq("estate_id", user.estate_id);

      if (user.home_id) q = q.eq("home_id", user.home_id);

      const { data } = await q.maybeSingle();
      deviceRow = data;
    }

    // If not found, still emit signal (audit), but immediate execute needs it
    const deviceRef = deviceRow?.id || rawId;

    // ✅ Always write the audit signal first
    await handleSignal({
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      source: "user",
      type: "device.command.requested",
      timestamp: new Date().toISOString(),
      deviceId: deviceRef,
      command,
      requestedBy: {
        userId: user.id,
        role: user.role,
      },
      metadata: {
        raw_device_ref: rawId,
        resolved_device_uuid: deviceRow?.id || null,
      },
    });

    // ------------------------------------------------------------
    // ✅ FAST PATH: Execute immediately for Tuya devices
    // ------------------------------------------------------------
    if (deviceRow?.vendor === "tuya" && deviceRow?.external_id) {
      initAdaptersOnce();
      const adapter = adapterRegistry.get("tuya");

      if (!adapter) {
        return res.status(500).json({ error: "Tuya adapter not registered" });
      }

      const normalized = normalizeCommand(command);

      await adapter.executeCommand(deviceRow.external_id, normalized, {
        estateId: deviceRow.estate_id,
        homeId: deviceRow.home_id,
        userId: user.id,
        credentials: {
          // TuyaClient reads env itself, so nothing strictly required here
          // (but leaving object keeps shape consistent)
        },
      } as any);

      // Optional: write a quick “last known” state (helps UI feel instant)
      await supabaseAdmin
        .from("device_states")
        .upsert(
          {
            device_id: deviceRow.id,
            status: { last_command: normalized },
            last_seen: new Date().toISOString(),
          } as any,
          { onConflict: "device_id" } as any
        );

      return res.status(200).json({
        ok: true,
        status: "command_executed",
        device: { id: deviceRow.id, external_id: deviceRow.external_id, vendor: deviceRow.vendor },
        command: normalized,
      });
    }

    // Default behavior (non-tuya or unresolved)
    return res.status(202).json({
      ok: true,
      status: "command_queued",
      device: deviceRow
        ? { id: deviceRow.id, external_id: deviceRow.external_id, vendor: deviceRow.vendor }
        : { ref: rawId },
    });
  } catch (e: any) {
    console.error("requestDeviceCommand error:", e?.message || e);
    return res.status(500).json({
      error: "Command failed",
      details: e?.message || String(e),
    });
  }
}
