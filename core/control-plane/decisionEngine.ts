// src/core/control-plane/decisionEngine.ts
import { Signal } from "./signal.types";
import { Intent } from "./intent.types";

import { visitorPolicy } from "./policies/visitor.policy";
import { securityPolicy } from "./policies/security.policy";
import { energyPolicy } from "./policies/energy.policy";

export function evaluateSignal(signal: Signal): Intent[] {
  return [
    ...visitorPolicy(signal),
    ...securityPolicy(signal),
    ...energyPolicy(signal),
  ];
}
