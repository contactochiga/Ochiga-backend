import { supabaseAdmin } from "../supabase/supabaseClient";
import { getIO } from "../realtime/io";

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
