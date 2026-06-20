import { supabaseAdmin } from "../supabase/supabaseClient";
import { getIO } from "../realtime/io";
import { publishSourceIntelligenceEvent } from "../intelligence-core";

export type ServiceRegistryEventName =
  | "service.config.updated"
  | "home.service_registry.updated"
  | "home.utility_account.updated"
  | "wallet.service_payment.updated";

type ServiceRegistryEventInput = {
  event: ServiceRegistryEventName;
  estate_id?: string | null;
  home_id?: string | null;
  service_key?: string | null;
  user_id?: string | null;
  actor_id?: string | null;
  payload?: Record<string, any> | null;
};

function cleanId(value?: string | null) {
  const text = String(value || "").trim();
  return text || null;
}

export async function emitServiceRegistryEvent(input: ServiceRegistryEventInput) {
  const now = new Date().toISOString();
  const event = {
    event_type: input.event,
    estate_id: cleanId(input.estate_id),
    home_id: cleanId(input.home_id),
    service_key: cleanId(input.service_key),
    user_id: cleanId(input.user_id),
    actor_id: cleanId(input.actor_id),
    payload: input.payload || {},
    created_at: now,
  };

  try {
    await supabaseAdmin.from("service_registry_events").insert([event]);
  } catch (err: any) {
    const message = String(err?.message || "");
    if (!message.includes("service_registry_events") && !message.includes("schema cache") && !message.includes("does not exist")) {
      console.warn("service registry event insert failed:", err);
    }
  }

  void publishSourceIntelligenceEvent({
    source: "facility",
    surface: "facility",
    event_type: input.event,
    category: /payment/.test(input.event) ? "wallet" : "service",
    estate_id: event.estate_id,
    home_id: event.home_id,
    actor_id: event.actor_id,
    entity_type: "service_registry",
    entity_id: event.service_key || event.home_id || event.estate_id,
    entity_label: event.service_key || "Service registry",
    severity: "info",
    title: `Service registry ${String(input.event).split(".").pop() || "updated"}`,
    summary: `Service configuration changed for ${event.service_key || "the active scope"}.`,
    payload: event.payload || {},
    occurred_at: now,
  }, { source_table: "service_registry_events", source_event_id: `${input.event}:${event.home_id || event.estate_id || "global"}:${event.service_key || "all"}:${now}` });

  const socketPayload = { ...event, event: input.event, timestamp: now };
  const io = getIO();
  if (!io) return socketPayload;
  if (event.estate_id) io.to(`estate:${event.estate_id}`).emit(input.event, socketPayload);
  if (event.home_id) io.to(`home:${event.home_id}`).emit(input.event, socketPayload);
  if (event.user_id) io.to(`user:${event.user_id}`).emit(input.event, socketPayload);
  if (event.estate_id) io.to(`estate:${event.estate_id}`).emit("service.updated", socketPayload);
  if (event.home_id) io.to(`home:${event.home_id}`).emit("service.updated", socketPayload);
  if (event.user_id) io.to(`user:${event.user_id}`).emit("service.updated", socketPayload);
  return socketPayload;
}
