import { evidenceEnvelope } from "../../evidence/EvidenceEnvelope";
import { classifyFreshness } from "../../contracts/freshness";
import { observationPolicyForDevice } from "./deviceObservationPolicy";

export function runtimeEvidenceForDevice(input: {
  device: Record<string, unknown>;
  runtime: Record<string, unknown> | null;
  scope: { estate_id: string | null; home_id: string | null; room_id: string | null };
}) {
  const policy = observationPolicyForDevice(input.device, input.runtime);
  const observedAt = String(input.runtime?.provider_timestamp || input.runtime?.runtime_timestamp || input.runtime?.last_refresh || "") || null;
  return evidenceEnvelope({
    domain: "devices",
    type: "runtime_state",
    object_type: "device",
    object_id: String(input.device.id || input.runtime?.device_id || "") || null,
    source: "runtime",
    observed_at: observedAt,
    freshness: classifyFreshness(policy, observedAt),
    authorised_scope: input.scope,
    confidence: input.runtime ? 0.82 : 0.2,
    payload: {
      policy,
      runtime_available: Boolean(input.runtime),
      provider_timestamp: input.runtime?.provider_timestamp || null,
      runtime_timestamp: input.runtime?.runtime_timestamp || null,
    },
  });
}
