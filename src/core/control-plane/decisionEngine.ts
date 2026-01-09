// src/core/control-plane/decisionEngine.ts
import { Signal } from "./signal.types";
import { Intent } from "./intent.types";

import { visitorPolicy } from "./policies/visitor.policy";
import { securityPolicy } from "./policies/security.policy";
import { energyPolicy } from "./policies/energy.policy";

type PolicyFn = (signal: Signal) => Intent[];

const policies: PolicyFn[] = [
  visitorPolicy,
  securityPolicy,
  energyPolicy,
];

export function evaluateSignal(signal: Signal): Intent[] {
  const intents: Intent[] = [];

  for (const policy of policies) {
    try {
      intents.push(...policy(signal));
    } catch (err) {
      console.error("❌ Policy failed:", policy.name, err);
    }
  }

  return intents;
}
