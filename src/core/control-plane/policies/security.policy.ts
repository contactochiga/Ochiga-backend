// src/core/control-plane/policies/security.policy.ts

import { Signal } from "../contracts/signal.types";
import { Intent } from "../contracts/intent.types";

export function securityPolicy(_: Signal): Intent[] {
  return [];
}
