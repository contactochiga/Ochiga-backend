// src/core/control-plane/policies/visitor.policy.ts
import { Signal } from "../signal.types";
import { Intent } from "../intent.types";

export function visitorPolicy(signal: Signal): Intent[] {
  if (signal.type !== "visitor.arrived") return [];

  return [
    {
      target: "notification",
      priority: "high",
      reason: "visitor_arrival",
      audience: "resident",
      scope: "home",
      referenceId: signal.homeId,
      payload: {
        title: "Visitor at the gate",
        message: "A visitor has arrived and requires approval.",
        type: "visitor",
      },
    },
  ];
}
