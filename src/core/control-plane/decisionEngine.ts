import { Signal } from "./contracts/signal.types";
import { Intent } from "./contracts/intent.types";

import { visitorPolicy } from "./policies/visitor.policy";
import { energyPolicy } from "./policies/energy.policy";
import { securityPolicy } from "./policies/security.policy";

// ✅ add these
import { deviceCapabilityPolicy } from "./policies/deviceCapability.policy";
import { devicePermissionPolicy } from "./policies/devicePermission.policy";
import { deviceCommandPolicy } from "./policies/deviceCommand.policy";

type Policy = (signal: Signal) => Intent[];

export function evaluateSignal(signal: Signal): Intent[] {
  const policies: Policy[] = [
    // device pipeline
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
    } catch (err) {
      console.error(`❌ Policy failed safely: ${policy.name}`, err);
      // IMPORTANT: if a device policy throws (permission/capability), we STOP here
      // so command doesn’t execute silently.
      if (String(signal.type).startsWith("device.")) break;
    }
  }

  return intents;
}
