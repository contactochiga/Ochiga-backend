// src/workers/intentWorker.ts
import { Worker, Queue, Job } from "bullmq";
import {
  Intent,
  NotifyIntent,
  DeviceCommandIntent,
} from "../core/control-plane/contracts/intent.types";

import { NotificationService } from "../services/NotificationService";
import { intentDlqQueue } from "./intentDlqWorker";

import { supabaseAdmin } from "../supabase/supabaseClient";
import { adapterRegistry } from "../device/adapters/registry";
import { publishDeviceAction } from "../device/bridge";

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
  // 1) Load device record so we know vendor + external_id
  const { data: device, error } = await supabaseAdmin
    .from("devices")
    .select("id, vendor, external_id, metadata, room_id, estate_id, home_id")
    .eq("id", intent.deviceId)
    .single();

  // If API passes external_id directly, fallback:
  const deviceKey = device?.external_id || intent.deviceId;

  if (error) {
    console.warn("⚠️ Device lookup failed, falling back to raw deviceId", {
      deviceId: intent.deviceId,
      error: error.message,
    });
  }

  const vendor = String(device?.vendor || "mqtt").toLowerCase();

  // 2) Execute by vendor
  if (vendor === "tuya") {
    const tuya: any = adapterRegistry.get("tuya");

    if (!tuya?.executeCommand) {
      throw new Error("Tuya adapter missing executeCommand()");
    }

    // executeCommand(deviceId, command, context) — context not used in your adapter
    await tuya.executeCommand(deviceKey, intent.command, {
      estateId: device?.estate_id || null,
      homeId: device?.home_id || null,
      roomId: device?.room_id || null,
      userId: null,
    });

    return true;
  }

  // 3) Default: MQTT publish
  const topic = `ochiga/device/${deviceKey}/set`;
  await publishDeviceAction(topic, intent.command);
  return true;
}
