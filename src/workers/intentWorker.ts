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
  return (intent as NotifyIntent).payload !== undefined && (intent as any).target === "notification";
}

function isDeviceIntent(intent: Intent): intent is DeviceCommandIntent {
  return (intent as DeviceCommandIntent).deviceId !== undefined && (intent as any).target === "device";
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
  // Load device row (we need vendor + external_id)
  const { data: device, error } = await supabaseAdmin
    .from("devices")
    .select("id, vendor, external_id, metadata, room_id, estate_id, home_id")
    .eq("id", intent.deviceId)
    .maybeSingle();

  if (error) {
    console.warn("⚠️ Device lookup error:", { deviceId: intent.deviceId, error: error.message });
  }

  // If missing, fallback (rare) using metadata.external_id if present
  const externalId =
    device?.external_id ||
    (device?.metadata as any)?.external_id ||
    (device?.metadata as any)?.externalId ||
    null;

  const vendor = String(device?.vendor || "mqtt").toLowerCase();

  // Route by vendor
  if (vendor === "tuya") {
    if (!externalId) {
      throw new Error("Tuya device missing external_id (cannot send command to Tuya)");
    }

    const tuya = adapterRegistry.get("tuya") as any;
    if (!tuya?.executeCommand) {
      throw new Error("Tuya adapter not registered or missing executeCommand()");
    }

    // Optional context if your adapter later needs it
    const context = {
      estateId: device?.estate_id ?? null,
      homeId: device?.home_id ?? null,
      userId: null,
      credentials: (device?.metadata as any)?.credentials,
    };

    return tuya.executeCommand(externalId, intent.command, context);
  }

  // Default MQTT route (deviceKey can be UUID or externalId depending on your MQTT device naming)
  const deviceKey = externalId || intent.deviceId;
  const topic = `ochiga/device/${deviceKey}/set`;
  return publishDeviceAction(topic, intent.command);
}
