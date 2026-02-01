// src/core/control-plane/decisionEngine.ts
import { Signal } from "./contracts/signal.types";
import { Intent } from "./contracts/intent.types";

import { visitorPolicy } from "./policies/visitor.policy";
import { energyPolicy } from "./policies/energy.policy";
import { securityPolicy } from "./policies/security.policy";

// ✅ ADD THESE
import { deviceCapabilityPolicy } from "./policies/deviceCapability.policy";
import { devicePermissionPolicy } from "./policies/devicePermission.policy";
import { deviceCommandPolicy } from "./policies/deviceCommand.policy";

type Policy = (signal: Signal) => Intent[];

export function evaluateSignal(signal: Signal): Intent[] {
  const policies: Policy[] = [
    // ✅ For device commands: validate first, then convert to intent
    devicePermissionPolicy,
    deviceCapabilityPolicy,
    deviceCommandPolicy,

    // existing
    visitorPolicy,
    energyPolicy,
    securityPolicy,
  ];

  const intents: Intent[] = [];

  for (const policy of policies) {
    try {
      const result = policy(signal);

      if (Array.isArray(result) && result.length) {
        intents.push(...result);
      }
    } catch (err: any) {
      // ✅ IMPORTANT: if a policy rejects a signal (throws), stop processing.
      console.error(`❌ Policy denied signal: ${policy.name}`, err?.message || err);
      return [];
    }
  }

  return intents;
}
