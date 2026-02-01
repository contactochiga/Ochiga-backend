import { Signal } from "./contracts/signal.types";
import { Intent } from "./contracts/intent.types";

import { visitorPolicy } from "./policies/visitor.policy";
import { energyPolicy } from "./policies/energy.policy";
import { securityPolicy } from "./policies/security.policy";

// ✅ add these
import { devicePermissionPolicy } from "./policies/devicePermission.policy";
import { deviceCapabilityPolicy } from "./policies/deviceCapability.policy";
import { deviceCommandPolicy } from "./policies/deviceCommand.policy";

type Policy = (signal: Signal) => Intent[];

export function evaluateSignal(signal: Signal): Intent[] {
  const policies: Policy[] = [
    visitorPolicy,
    energyPolicy,
    securityPolicy,

    // ✅ device pipeline
    devicePermissionPolicy,
    deviceCapabilityPolicy,
    deviceCommandPolicy,
  ];

  const intents: Intent[] = [];

  for (const policy of policies) {
    try {
      const result = policy(signal);
      if (Array.isArray(result)) intents.push(...result);
    } catch (err) {
      console.error(`❌ Policy failed safely: ${policy.name}`, err);
    }
  }

  return intents;
}
