import { Signal } from "./signal.types";
import { Intent } from "./intent.types";

import { visitorPolicy } from "./policies/visitor.policy";

export function evaluateSignal(signal: Signal): Intent[] {
  const policies = [visitorPolicy];

  const intents: Intent[] = [];

  for (const policy of policies) {
    try {
      intents.push(...policy(signal));
    } catch (err) {
      console.error("Policy failed safely:", policy.name, err);
    }
  }

  return intents;
}
