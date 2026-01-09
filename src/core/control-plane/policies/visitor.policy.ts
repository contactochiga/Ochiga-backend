import { Signal } from "../signal.types";
import { Intent } from "../intent.types";
import { INTENT_SCHEMA_VERSION } from "../contracts";

export function visitorPolicy(signal: Signal): Intent[] {
  if (signal.type !== "visitor.arrived") return [];

  return [
    {
      schemaVersion: INTENT_SCHEMA_VERSION,
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
      context: {
        source_signal: signal.type,
        created_at: new Date().toISOString(),
      },
    },
  ];
}
