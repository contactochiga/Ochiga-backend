import type { CanonicalConversationRequestContext } from "../contracts/conversation";
import { MEMORY_CONTRACT_VERSION } from "../contracts/memory";
import { authorizeConversationThread } from "./conversationOwnership";
import { loadResidentMemoryContext } from "./residentMemoryContext";

/** One admission boundary before reasoning. Domain evidence still comes from
 * its existing authorized adapters; context is never a substitute for evidence. */
export async function assembleGovernedContext(input: CanonicalConversationRequestContext): Promise<CanonicalConversationRequestContext> {
  const context = await authorizeConversationThread(input);
  const { actor, oisContext } = context;
  const resident = actor?.role === "resident" && context.input.surface === "consumer";
  let memory: Awaited<ReturnType<typeof loadResidentMemoryContext>> = [];
  let memoryStatus: "not_applicable" | "available" | "unavailable" = "not_applicable";
  if (resident && actor) {
    try {
      memory = await loadResidentMemoryContext({ ...actor,
        estate_id: oisContext?.estate_id || actor.estate_id,
        home_id: oisContext?.home_id || actor.home_id });
      memoryStatus = "available";
    } catch { memoryStatus = "unavailable"; }
  }
  return { ...context, input: { ...context.input, context: {
    ...(context.input.context || {}),
    // Server-owned slot always replaces any client-supplied lookalike.
    governed_context: {
      version: "oyi-context/v1", memory_contract: MEMORY_CONTRACT_VERSION,
      identity: { actor_id: actor?.id || null, role: actor?.role || null, surface: context.input.surface },
      permissions: oisContext?.permissions || actor?.permissions || [],
      scope: { estate_id: oisContext?.estate_id || actor?.estate_id || null, home_id: oisContext?.home_id || actor?.home_id || null },
      conversation: { thread_id: context.input.thread_id || null, ownership_checked: true },
      memory, memory_status: memoryStatus,
      knowledge_authority: "knowledgeRetrieval",
      relationship_authority: context.input.surface === "office_internal" ? "authorized_office_bridge" : null,
      operational_evidence_authority: "canonical_domain_adapters",
      capability_authority: "CapabilityService",
      context_grants_authority: false,
    },
  } } };
}
