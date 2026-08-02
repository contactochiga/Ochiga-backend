import type { CapabilityContext, CapabilityModule } from "../contracts/capability";
import { capabilityRegistry } from "../capabilities/CapabilityRegistry";

export function selectCapability(context: Omit<CapabilityContext, "legacyFallback">): CapabilityModule | null {
  return capabilityRegistry.find(context.resolvedTurn.semantic_frame);
}
