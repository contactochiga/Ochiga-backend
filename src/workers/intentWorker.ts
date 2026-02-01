// src/workers/intentWorker.ts
import { Worker, Queue, Job } from "bullmq";
import {
  Intent,
  NotifyIntent,
  DeviceCommandIntent,
} from "../core/control-plane/contracts/intent.types";
import { NotificationService } from "../services/NotificationService";
import { publishDeviceAction } from "../device/bridge";
import { intentDlqQueue } from "./intentDlqWorker";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { adapterRegistry } from "../device/adapters/registry";

const connection = {
  url: process.env.REDIS_URL || "redis://localhost:6379",
};

// -----------------------------
// Intent Queue
// -----------------------------
export const intentQueue = new Queue<Intent>("intents", { connection });

// -----------------------------
// Enqueue Intent
// -----------------------------
export async function enqueueIntent(intent: Intent) {
  await intentQueue.add("execute", intent, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: true,
    removeOnFail: false,
  });
}

// -----------------------------
// Worker
// -----------------------------
export function startIntentWorker() {
  const worker = new Worker<Intent>(
    "intents",
    async (job: Job<Intent>) => {
      const intent = job.data;

      if (isNotificationIntent(intent)) {
        return handleNotificationIntent(intent);
      }

      if (isDeviceIntent(intent)) {
        return handleDeviceIntent(intent);
      }

      throw new Error("Unhandled intent shape");
    },
    { connection }
  );

  // -----------------------------
  // DLQ handoff
  // -----------------------------
  worker.on("failed", async (job) => {
    if (!job) return;

    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await intentDlqQueue.add("dlq", job.data);
    }
  });

  return worker;
}

// -----------------------------
// Type Guards
// -----------------------------
function isNotificationIntent(intent: Intent): intent is NotifyIntent {
  return (intent as NotifyIntent).payload !== undefined;
}

function isDeviceIntent(intent: Intent): intent is DeviceCommandIntent {
  return (intent as DeviceCommandIntent).deviceId !== undefined;
}

// -----------------------------
// Handlers
// -----------------------------
async function handleNotificationIntent(intent: NotifyIntent) {
  const { scope, referenceId, payload } = intent;

  switch (scope) {
    case "user":
      return NotificationService.sendToUser(referenceId, payload);

    case "home":
      return NotificationService.sendToHome(referenceId, payload);

    case "estate":
      return NotificationService.sendToEstate(referenceId, payload);

    case "region":
      return NotificationService.sendToRole(referenceId, "resident", payload);

    default:
      throw new Error("Unhandled notification scope");
  }
}

async function handleDeviceIntent(intent: DeviceCommandIntent) {
  // 1) Try load device row by uuid id first
  let device: any = null;

  const byId = await supabaseAdmin
    .from("devices")
    .select("id, vendor, external_id, metadata, room_id, estate_id, home_id")
    .eq("id", intent.deviceId)
    .maybeSingle();

  if (byId.error) {
    console.warn("⚠️ Device lookup by id failed:", byId.error.message);
  }
  device = byId.data || null;

  // 2) Fallback: maybe intent.deviceId is actually external_id (tuya dev_id)
  if (!device) {
    const byExternal = await supabaseAdmin
      .from("devices")
      .select("id, vendor, external_id, metadata, room_id, estate_id, home_id")
      .eq("external_id", intent.deviceId)
      .maybeSingle();

    if (byExternal.error) {
      console.warn("⚠️ Device lookup by external_id failed:", byExternal.error.message);
    }
    device = byExternal.data || null;
  }

  // 3) Determine stable key to send to downstream vendor
  // - For Tuya: MUST be external_id (tuya device id)
  // - For MQTT fallback: can be whatever you use as device key
  const deviceKey = device?.external_id || intent.deviceId;
  const vendor = String(device?.vendor || "mqtt").toLowerCase();

  // 4) Build adapter context (best-effort)
  const ctx = {
    estateId: device?.estate_id || null,
    homeId: device?.home_id || null,
    userId: (intent as any)?.requestedBy?.userId || null,
    roomId: device?.room_id || null,
    // If you store tuyaUid in metadata.context, pass it through:
    credentials: {
      tuyaUid:
        device?.metadata?.context?.tuyaUid ||
        device?.metadata?.tuyaUid ||
        null,
    },
  };

  // 5) Route by vendor
  if (vendor === "tuya") {
    const tuya: any = adapterRegistry.get("tuya");
    if (!tuya) throw new Error("Tuya adapter not registered");

    if (typeof tuya.executeCommand === "function") {
      // TuyaAdapter signature: executeCommand(deviceId, command, context)
      await tuya.executeCommand(deviceKey, intent.command, ctx);
      return true;
    }

    // fallback if your registry exposes a different method name
    if (typeof tuya.command === "function") {
      await tuya.command(deviceKey, intent.command, ctx);
      return true;
    }

    throw new Error("Tuya adapter missing executeCommand/command method");
  }

  // 6) Default: MQTT publish
  const topic = `ochiga/device/${deviceKey}/set`;
  await publishDeviceAction(topic, intent.command);
  return true;
}
