import type { AuthUser } from "../../middleware/auth";
import type { OisContext } from "../../types/oisContext";
import type { CanonicalConversationRequest } from "../runtime/canonicalConversationRuntime";

export function mapOyiRouteBodyToConversationRequest(body: any, oisContext: OisContext | null | undefined, mode: "chat" | "runtime"): CanonicalConversationRequest {
  return {
    ...(body || {}),
    message: String(mode === "runtime" ? body?.request?.query || body?.message || body?.prompt || "" : body?.message || body?.prompt || "").trim(),
    surface: oisContext?.surface as any,
    estate_id: oisContext?.estate_id || null,
    home_id: oisContext?.home_id || null,
    module: oisContext?.module || body?.module || null,
    thread_id: body?.thread_id || body?.request?.thread_id || null,
    context: mode === "runtime"
      ? { ...(body?.request?.context || {}), ...(body?.context || {}), ...(oisContext || {}) }
      : { ...(body?.context || {}), ...(oisContext || {}) },
    target: body?.target || body?.request?.target || oisContext?.target || null,
  };
}

export function actorTraceMetadata(actor: AuthUser | null) {
  return { actor_id: actor?.id || null, actor_role: actor?.role || null };
}
