import type { CapabilityContext, CapabilityModule } from "../../contracts/capability";
import type { OyiEvidence } from "../../contracts/evidence";
import type { SemanticFrame } from "../../contracts/semanticFrame";
import { authorizeDeviceConversation } from "./deviceAuthority";
import { DEVICE_CAPABILITY_KEYS } from "./deviceCapabilities";

function keyForFrame(frame: SemanticFrame) {
  if (frame.operation === "device.activity") return "devices.activity";
  if (frame.operation === "device.failures") return "devices.failures";
  if (frame.operation === "device.diagnosis") return "devices.diagnosis";
  if (frame.operation === "device.relationships") return "devices.relationships";
  if (frame.operation === "device.power.on" || frame.operation === "device.power.off") return "devices.control.power";
  if (frame.operation === "device.status") return "devices.status";
  if (frame.constraints.some((constraint) => constraint.type === "channel")) return "devices.control.channel";
  return "devices.status";
}

export class DeviceDomainAdapter implements CapabilityModule {
  readonly key = "devices.adapter";
  readonly domain = "devices" as const;
  readonly rolloutStatus = "enabled" as const;

  supports(frame: SemanticFrame) {
    return frame.domain === "devices" || frame.operation.startsWith("device.");
  }

  async resolve(context: CapabilityContext) {
    const key = keyForFrame(context.resolvedTurn.semantic_frame);
    return {
      supported: (DEVICE_CAPABILITY_KEYS as readonly string[]).includes(key),
      reason: null,
    };
  }

  async collectEvidence(_context: CapabilityContext): Promise<OyiEvidence[]> {
    // Phase 1 delegates the mature evidence/building path to the accepted canonical runtime.
    return [];
  }

  async authorize(context: CapabilityContext) {
    return authorizeDeviceConversation(context);
  }

  async buildReadResponse(context: CapabilityContext) {
    return context.legacyFallback();
  }

  async createDraft(context: CapabilityContext) {
    return context.legacyFallback();
  }
}

export const deviceDomainAdapter = new DeviceDomainAdapter();
