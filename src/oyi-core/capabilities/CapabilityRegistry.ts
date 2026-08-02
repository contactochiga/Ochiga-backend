import type { CapabilityModule } from "../contracts/capability";
import type { SemanticFrame } from "../contracts/semanticFrame";
import { assertEnabledCapabilityHasAdapter, capabilityEnabled } from "./CapabilityRollout";

export class CapabilityRegistry {
  private readonly modules = new Map<string, CapabilityModule>();

  register(module: CapabilityModule) {
    assertEnabledCapabilityHasAdapter(module);
    this.modules.set(module.key, module);
  }

  all() {
    return Array.from(this.modules.values());
  }

  enabled() {
    return this.all().filter(capabilityEnabled);
  }

  find(frame: SemanticFrame) {
    return this.enabled().find((module) => module.supports(frame)) || null;
  }

  get(key: string) {
    return this.modules.get(key) || null;
  }
}

export const capabilityRegistry = new CapabilityRegistry();
