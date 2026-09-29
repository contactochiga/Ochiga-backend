/** Memory is retained context, never a permission grant or live operational fact. */
export const MEMORY_CONTRACT_VERSION = "oyi-memory/v1" as const;
export type MemoryKind = "conversation" | "knowledge_reference" | "actor_context" | "relationship_context" | "operational_reference";
export type GovernedMemory = {
  id: string;
  kind: MemoryKind;
  owner: "core" | "office";
  scope: { actorId: string; estateId: string | null; homeId: string | null; sessionId: string | null };
  audience: "actor_private";
  provenance: { store: string; recordId: string; observedAt: string };
  retention: "durable" | "transient";
  expiresAt: string | null;
  trust: "context_only";
  value: Record<string, unknown>;
};

export function memoryVisibleTo(memory: GovernedMemory, scope: GovernedMemory["scope"], now = Date.now()): boolean {
  return memory.audience === "actor_private" && memory.trust === "context_only"
    && memory.scope.actorId === scope.actorId
    && memory.scope.estateId === scope.estateId
    && memory.scope.homeId === scope.homeId
    && (!memory.scope.sessionId || memory.scope.sessionId === scope.sessionId)
    && Number.isFinite(Date.parse(memory.provenance.observedAt))
    && Date.parse(memory.provenance.observedAt) <= now
    && (memory.expiresAt === null || (Number.isFinite(Date.parse(memory.expiresAt)) && Date.parse(memory.expiresAt) > now));
}
