import type { AuthUser } from "../middleware/auth";
import { upsertResidentMemory } from "../services/intelligenceMemoryService";
import type { IntelligenceContext, IntelligenceMemoryRecord } from "./types";

function allowedOyiMemoryScope(scope: string) {
  return scope === "user" || scope === "home" || scope === "estate";
}

export async function writeScopedMemory(actor: AuthUser, context: IntelligenceContext, memory: IntelligenceMemoryRecord) {
  if (context.agent_id === "oyi" || context.agent_id === "watch") {
    if (!allowedOyiMemoryScope(memory.scope)) {
      return { ok: false, skipped: true, reason: "scope_not_allowed_for_resident_memory" };
    }
    await upsertResidentMemory(actor, {
      memoryType: `${context.agent_id}_${memory.scope}`,
      key: memory.key,
      value: {
        ...memory.value,
        core_id: context.core_id,
        agent_id: context.agent_id,
        surface: context.surface,
      },
    });
    return { ok: true };
  }

  return {
    ok: false,
    skipped: true,
    reason: "phase1_contract_only_memory_adapter",
  };
}
