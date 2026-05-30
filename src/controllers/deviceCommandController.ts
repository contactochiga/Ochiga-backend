// src/controllers/deviceCommandController.ts
import { Request, Response } from "express";
import { handleSignal } from "../core/control-plane";
import { SIGNAL_SCHEMA_VERSION } from "../core/control-plane/contracts";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { adapterRegistry } from "../device/adapters/registry";
import { initAdaptersOnce } from "../device/adapters/initAdapters";
import { NotificationService } from "../services/NotificationService";
import { emitAuditEvent } from "../core/foundation";
import type { AuthUser } from "../middleware/auth";

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

function pickExpectedState(command: Record<string, any>) {
  if (typeof command?.switch === "boolean") return { key: "switch", value: command.switch };
  if (typeof command?.power === "boolean") return { key: "power", value: command.power };
  if (typeof command?.on === "boolean") return { key: "on", value: command.on };
  return null;
}

function describeDeviceCommand(deviceName: any, command: Record<string, any>) {
  const name = String(deviceName || "Device").trim() || "Device";
  const value =
    typeof command?.switch === "boolean" ? command.switch :
    typeof command?.power === "boolean" ? command.power :
    typeof command?.on === "boolean" ? command.on :
    undefined;

  if (typeof value === "boolean") {
    return {
      title: `${name} ${value ? "turned on" : "turned off"}`,
      message: value ? `${name} is now on.` : `${name} is now off.`,
    };
  }

  return {
    title: `${name} updated`,
    message: `${name} command executed successfully.`,
  };
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeDeviceCommandForActor(input: {
  actor: AuthUser;
  deviceId: string;
  command: Record<string, any>;
  req?: Request;
}) {
  const rawId = String(input.deviceId || "").trim();
  const command = input.command;
  const user = input.actor;

  if (!rawId) throw new Error("deviceId is required");
  if (!command) throw new Error("command is required");
  if (!user?.id) throw new Error("Not authenticated");

  let deviceRow: any = null;
  const scoped = (query: any) => {
    let next = query;
    if (user.estate_id) next = next.eq("estate_id", user.estate_id);
    if (user.home_id) next = next.eq("home_id", user.home_id);
    return next;
  };

  if (isUuid(rawId)) {
    const { data } = await scoped(supabaseAdmin.from("devices").select("*").eq("id", rawId)).maybeSingle();
    deviceRow = data;
  } else {
    const { data } = await scoped(supabaseAdmin.from("devices").select("*").eq("external_id", rawId)).maybeSingle();
    deviceRow = data;
  }

  const deviceRef = deviceRow?.id || rawId;

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
      source: "oyi_ai",
    },
  });
  void emitAuditEvent({
    actorId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    action: "device.command.requested",
    resourceType: "device",
    resourceId: deviceRef,
    estateId: deviceRow?.estate_id || user.estate_id,
    homeId: deviceRow?.home_id || user.home_id,
    status: "success",
    metadata: { command, raw_device_ref: rawId, resolved_device_uuid: deviceRow?.id || null, source: "oyi_ai" },
    req: input.req,
  } as any);

  if (deviceRow?.vendor === "tuya" && deviceRow?.external_id) {
    initAdaptersOnce();
    const adapter = adapterRegistry.get("tuya");
    if (!adapter) throw new Error("Tuya adapter not registered");

    const normalized = normalizeCommand(command);
    await adapter.executeCommand(deviceRow.external_id, normalized, {
      estateId: deviceRow.estate_id,
      homeId: deviceRow.home_id,
      userId: user.id,
      credentials: {},
    } as any);

    let verifiedState: Record<string, any> | null = null;
    const expected = pickExpectedState(normalized);
    if (expected && typeof (adapter as any).getLiveState === "function") {
      await delay(900);
      try {
        verifiedState = await (adapter as any).getLiveState(deviceRow.external_id);
      } catch {}
      if (verifiedState && expected.key in verifiedState) {
        const actual = Boolean((verifiedState as any)[expected.key]);
        if (actual !== Boolean(expected.value)) {
          const error = new Error("Device did not confirm the requested state change");
          (error as any).status = "command_unverified";
          throw error;
        }
      }
    }

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

    const activityCopy = describeDeviceCommand(deviceRow.name, normalized);
    await NotificationService.sendToUser(String(user.id), {
      title: activityCopy.title,
      message: activityCopy.message,
      type: "device",
      payload: {
        device_id: String(deviceRow.id),
        external_id: String(deviceRow.external_id || ""),
        estate_id: String(deviceRow.estate_id || ""),
        home_id: String(deviceRow.home_id || ""),
        command: normalized,
        kind: "device.command.executed",
        source: "oyi_ai",
      },
      entityId: String(deviceRow.id),
    });
    void emitAuditEvent({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: "device.command.executed",
      resourceType: "device",
      resourceId: deviceRow.id,
      estateId: deviceRow.estate_id,
      homeId: deviceRow.home_id,
      status: "success",
      metadata: { command: normalized, vendor: deviceRow.vendor, external_id: deviceRow.external_id, source: "oyi_ai" },
      req: input.req,
    } as any);

    return {
      ok: true,
      status: "command_executed",
      device: { id: deviceRow.id, name: deviceRow.name, external_id: deviceRow.external_id, vendor: deviceRow.vendor },
      command: normalized,
      state: verifiedState,
    };
  }

  return {
    ok: true,
    status: "command_queued",
    device: deviceRow
      ? { id: deviceRow.id, name: deviceRow.name, external_id: deviceRow.external_id, vendor: deviceRow.vendor }
      : { ref: rawId },
  };
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
        .select("id, name, vendor, external_id, estate_id, home_id, room_id")
        .eq("id", rawId)
        .eq("estate_id", user.estate_id);

      if (user.home_id) q = q.eq("home_id", user.home_id);

      const { data } = await q.maybeSingle();
      deviceRow = data;
    } else {
      let q = supabaseAdmin
        .from("devices")
        .select("id, name, vendor, external_id, estate_id, home_id, room_id")
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
    void emitAuditEvent({
      actorId: user.id,
      actorRole: user.role,
      action: "device.command.requested",
      resourceType: "device",
      resourceId: deviceRef,
      estateId: deviceRow?.estate_id || user.estate_id,
      status: "success",
      metadata: { command, raw_device_ref: rawId, resolved_device_uuid: deviceRow?.id || null },
      req,
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

      let verifiedState: Record<string, any> | null = null;
      const expected = pickExpectedState(normalized);
      if (expected && typeof (adapter as any).getLiveState === "function") {
        await delay(900);
        try {
          verifiedState = await (adapter as any).getLiveState(deviceRow.external_id);
        } catch {}
        if (verifiedState && expected.key in verifiedState) {
          const actual = Boolean((verifiedState as any)[expected.key]);
          if (actual !== Boolean(expected.value)) {
            return res.status(409).json({
              ok: false,
              error: "Device did not confirm the requested state change",
              status: "command_unverified",
              device: { id: deviceRow.id, external_id: deviceRow.external_id, vendor: deviceRow.vendor },
              command: normalized,
              state: verifiedState,
            });
          }
        }
      }

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

      const activityCopy = describeDeviceCommand(deviceRow.name, normalized);
      await NotificationService.sendToUser(String(user.id), {
        title: activityCopy.title,
        message: activityCopy.message,
        type: "device",
        payload: {
          device_id: String(deviceRow.id),
          external_id: String(deviceRow.external_id || ""),
          estate_id: String(deviceRow.estate_id || ""),
          home_id: String(deviceRow.home_id || ""),
          command: normalized,
          kind: "device.command.executed",
        },
        entityId: String(deviceRow.id),
      });
      void emitAuditEvent({
        actorId: user.id,
        actorRole: user.role,
        action: "device.command.executed",
        resourceType: "device",
        resourceId: deviceRow.id,
        estateId: deviceRow.estate_id,
        status: "success",
        metadata: { command: normalized, vendor: deviceRow.vendor, external_id: deviceRow.external_id },
        req,
      });

      return res.status(200).json({
        ok: true,
        status: "command_executed",
        device: { id: deviceRow.id, external_id: deviceRow.external_id, vendor: deviceRow.vendor },
        command: normalized,
        state: verifiedState,
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
    const user = (req as any).user;
    const rawId = String(req.params.deviceId || "").trim();
    if (user?.id) {
      try {
        await NotificationService.sendToUser(String(user.id), {
          title: "Device command failed",
          message: `We could not execute your device command.`,
          type: "device",
          payload: {
            device_ref: rawId || null,
            command: req.body?.command || null,
            error: e?.message || String(e),
            kind: "device.command.failed",
          },
          entityId: rawId || undefined,
        });
      } catch {}
    }
    return res.status(500).json({
      error: "Command failed",
      details: e?.message || String(e),
    });
  }
}
