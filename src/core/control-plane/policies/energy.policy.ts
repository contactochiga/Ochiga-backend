// src/core/control-plane/policies/energy.policy.ts

import { Signal } from "../contracts/signal.types";
import { Intent } from "../contracts/intent.types";

export function energyPolicy(_: Signal): Intent[] {
  return [];
}
