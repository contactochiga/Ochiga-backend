// src/workers/intentWorker.ts
import { Worker, Queue, Job } from "bullmq";
import {
  Intent,
  NotifyIntent,
  DeviceCommandIntent,
  UniversalIntent,
} from "../core/control-plane/contracts/intent.types";
import { NotificationService } from "../services/NotificationService";
import { publishDeviceAction } from "../device/bridge";
import { intentDlqQueue } from "./intentDlqWorker";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { adapterRegistry } from "../device/adapters/registry";
import { publishSourceIntelligenceEvent } from "../intelligence-core";

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

      if (isUniversalIntent(intent)) {
        return handleUniversalIntent(intent);
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

function isUniversalIntent(intent: Intent): intent is UniversalIntent {
  return (intent as UniversalIntent).target === "intelligence" && typeof (intent as UniversalIntent).intent === "string";
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

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

async function handleDeviceIntent(intent: DeviceCommandIntent) {
  const rawRef = String(intent.deviceId || "").trim();

  // 1) Resolve device row by UUID or by external_id
  let device: any = null;

  if (isUuid(rawRef)) {
    const { data } = await supabaseAdmin
      .from("devices")
      .select("id, vendor, external_id, metadata, room_id, estate_id, home_id")
      .eq("id", rawRef)
      .maybeSingle();
    device = data;
  } else {
    const { data } = await supabaseAdmin
      .from("devices")
      .select("id, vendor, external_id, metadata, room_id, estate_id, home_id")
      .eq("external_id", rawRef)
      .maybeSingle();
    device = data;
  }

  // deviceKey is what vendor uses to control:
  // - Tuya: external_id
  // - MQTT legacy: could be external_id or id
  const vendor = String(device?.vendor || "mqtt").toLowerCase();
  const deviceKey = device?.external_id || rawRef;

  // 2) Route by vendor
  if (vendor === "tuya") {
    const tuya = adapterRegistry.get("tuya") as any;
    if (!tuya?.executeCommand) {
      throw new Error("Tuya adapter missing executeCommand");
    }

    // ✅ send to Tuya cloud with external_id
    await tuya.executeCommand(deviceKey, intent.command, {
      estateId: device?.estate_id,
      homeId: device?.home_id,
      roomId: device?.room_id,
    });

    return { ok: true, vendor: "tuya", deviceKey };
  }

  // 3) Default: MQTT publish (legacy)
  const topic = `ochiga/device/${deviceKey}/set`;
  await publishDeviceAction(topic, intent.command);
  return { ok: true, vendor: "mqtt", topic };
}

async function handleUniversalIntent(intent: UniversalIntent) {
  // Classification is durable and observable; execution remains with the registered tool boundary.
  await publishSourceIntelligenceEvent({
    source: intent.surface as any,
    surface: intent.surface as any,
    event_type: `intent.${intent.intent}.${intent.action}`,
    category: intent.intent === "report" ? "operational" : "workflow",
    estate_id: intent.context.estate_id || null,
    entity_type: intent.domain,
    entity_id: intent.entity_id || null,
    title: `Oyi ${intent.intent} intent`,
    summary: `Oyi classified a ${intent.domain} ${intent.action} request.`,
    payload: { intent: intent.intent, action: intent.action, workflow_id: intent.workflow_id || null },
  }, { source_table: "intents", source_event_id: `${intent.surface}:${intent.intent}:${intent.domain}:${intent.context.created_at}` });
  return { ok: true, classified: true, intent: intent.intent, domain: intent.domain, action: intent.action };
}
