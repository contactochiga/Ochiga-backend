import type { UniversalIntent } from "../core/control-plane/contracts/intent.types";

const DOMAIN_PATTERNS: Array<[string, RegExp]> = [
  ["visitor", /visitor|guest|access/i], ["maintenance", /maintenance|repair|work order/i], ["device", /device|light|switch|socket|hardware/i],
  ["wallet", /wallet|payment|transaction|balance/i], ["service", /service|utility|water|electric|internet/i], ["community", /community|announcement|notice|report/i],
  ["camera", /camera|cctv|stream/i], ["security", /security|incident|alarm|gate/i], ["lead", /lead|proposal|customer|campaign/i],
];

export function classifyUniversalIntent(input: { message: string; surface: UniversalIntent["surface"]; estate_id?: string | null; home_id?: string | null }): UniversalIntent {
  const message = String(input.message || "").trim();
  const lower = message.toLowerCase();
  const domain = DOMAIN_PATTERNS.find(([, pattern]) => pattern.test(lower))?.[0] || "general";
  const intent = /what('?s| is) happening|needs attention|what should i do/.test(lower) ? "awareness"
    : /report|summary|who did what/.test(lower) ? "report"
    : /why|when|who|history|activity|investigate/.test(lower) ? "investigation"
    : /assign/.test(lower) ? "assignment"
    : /approve|reject|revoke|expire|turn on|turn off|toggle|complete|cancel/.test(lower) ? "execution"
    : /show|open|list|any/.test(lower) ? "workflow"
    : "analytics";
  const action = /assign/.test(lower) ? "assign"
    : /approve/.test(lower) ? "approve"
    : /reject|revoke|expire|cancel/.test(lower) ? "cancel"
    : /turn on/.test(lower) ? "on"
    : /turn off/.test(lower) ? "off"
    : /toggle/.test(lower) ? "toggle"
    : /complete/.test(lower) ? "complete"
    : /show|open|list|any/.test(lower) ? "list" : "summarize";
  return {
    schemaVersion: "1.0.0", target: "intelligence", reason: "unified_intent_classification", priority: intent === "execution" ? "high" : "normal",
    context: { estate_id: input.estate_id || null, source_signal: "oyi.chat", created_at: new Date().toISOString() },
    surface: input.surface, intent, domain, action,
  };
}
