// src/core/control-plane/decisionEngine.ts

import { Signal } from "./contracts/signal.types";
import { Intent } from "./contracts/intent.types";

import { visitorPolicy } from "./policies/visitor.policy";
import { energyPolicy } from "./policies/energy.policy";
import { securityPolicy } from "./policies/security.policy";

type Policy = (signal: Signal) => Intent[];

export function evaluateSignal(signal: Signal): Intent[] {
  const policies: Policy[] = [
    visitorPolicy,
    energyPolicy,
    securityPolicy,
  ];

  const intents: Intent[] = [];

  for (const policy of policies) {
    try {
      const result = policy(signal);
      if (Array.isArray(result)) {
        intents.push(...result);
      }
    } catch (err) {
      console.error(`❌ Policy failed safely: ${policy.name}`, err);
    }
  }

  return intents;
}
