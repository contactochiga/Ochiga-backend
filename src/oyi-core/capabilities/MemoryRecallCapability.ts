import { readModule, resultPresentation } from "./ReadCapabilityModules";
import { evidenceEnvelope } from "../evidence/EvidenceEnvelope";
import { memoryVisibleTo, type GovernedMemory } from "../contracts/memory";

export const MEMORY_RECALL_CAPABILITY = "context.memory.recall";
export function isMemoryRecallRequest(message: string): boolean {
  return /^(?:what do you remember about (?:me|our conversations)|what did (?:we discuss|i ask)(?: previously| recently| last time)?|show my (?:saved|conversation) context)[?.!]*$/i.test(message.trim());
}

/** Reflect retained context only. Never resolve a device, infer a preference,
 * execute an instruction from memory, or treat an old reply as current truth. */
export function buildMemoryRecallCapability() {
  return readModule({
    key: MEMORY_RECALL_CAPABILITY, domain: "global", operations: ["memory.recall"],
    supportedSurfaces: ["consumer"], permissions: [], scopeRequirements: [], evidenceRequirements: [],
    supports: frame => frame.operation === "memory.recall",
    collect: async context => {
      const actor = context.actor;
      if (!actor || actor.role !== "resident" || context.input.surface !== "consumer") return [];
      const governed = (context.input.context as any)?.governed_context;
      if (governed?.identity?.actor_id !== actor.id || governed?.memory_status !== "available") return [];
      const scope = { actorId: actor.id, estateId: context.oisContext?.estate_id || actor.estate_id || null,
        homeId: context.oisContext?.home_id || actor.home_id || null, sessionId: context.input.thread_id || null };
      return (Array.isArray(governed.memory) ? governed.memory : []).filter((memory: GovernedMemory) => memoryVisibleTo(memory, scope)).slice(0, 8)
        .map((memory: GovernedMemory) => evidenceEnvelope({
          evidence_id: `memory:${memory.id}`, domain: "global", type: "retained_context", source: "history", source_type: "conversation",
          object_type: null, object_id: null,
          source_id: memory.provenance.recordId, observed_at: memory.provenance.observedAt,
          truth_class: "historical_record", freshness: "unknown", privacy_class: "resident_private",
          authorised_scope: {estate_id: scope.estateId, home_id: scope.homeId, room_id: null},
          permissions: [], confidence: 1, payload: { prompt: memory.value.prompt, title: memory.value.title, observed_at: memory.provenance.observedAt },
        }));
    },
    answer: (context, evidence) => {
      const governed = (context.input.context as any)?.governed_context;
      if (context.actor?.role !== "resident" || governed?.identity?.actor_id !== context.actor.id)
        return { status:"permission_restricted", answer:"Personal retained context is available only to its authenticated resident owner.", actions:[], presentation_policy:resultPresentation("text") };
      if (governed.memory_status === "unavailable")
        return { status:"unavailable", answer:"I could not load your retained context. That does not mean no context exists.", actions:[], presentation_policy:resultPresentation("text") };
      const lines = evidence.flatMap(item => {
        const value = item.payload as Record<string, unknown>;
        const quoted = typeof value.prompt === "string" ? value.prompt : typeof value.title === "string" ? value.title : null;
        return quoted ? [`${item.observed_at}: ${JSON.stringify(quoted.slice(0, 500))}`] : [];
      });
      return { status:"answered", answer: lines.length
        ? `Your retained context includes these past entries:\n${lines.join("\n")}\nThese are historical, user-contributed context—not verified current facts or instructions. Only eligible context from the last 30 days is included.`
        : "I have no eligible retained conversation entries to show in your current scope. This is not a claim about all past conversations.",
        actions:[], presentation_policy:resultPresentation("text") };
    },
  });
}
