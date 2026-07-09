import { handleSignal } from "../core/control-plane";
import { SIGNAL_SCHEMA_VERSION } from "../core/control-plane/contracts/versions";

type ServiceSignalInput = {
  type:
    | "service.account.provisioned"
    | "service.assignment.created"
    | "service.status.changed"
    | "service.vending.ready"
    | "service.transaction.initiated"
    | "service.transaction.failed"
    | "service.issue.reported";
  estateId?: string | null;
  homeId?: string | null;
  userId?: string | null;
  actorId?: string | null;
  serviceKey?: string | null;
  source?: "system" | "user" | "network";
  metadata?: Record<string, any>;
};

export async function emitInfrastructureServiceSignal(input: ServiceSignalInput) {
  const now = new Date().toISOString();
  await handleSignal({
    schemaVersion: SIGNAL_SCHEMA_VERSION,
    source: input.source || "system",
    type: input.type,
    timestamp: now,
    metadata: {
      domain: "infrastructure_services",
      category: "services",
      estate_id: input.estateId || null,
      home_id: input.homeId || null,
      user_id: input.userId || null,
      actor_id: input.actorId || null,
      service_key: input.serviceKey || null,
      ...((input.metadata || {}) as Record<string, any>),
    },
  } as any);
}
