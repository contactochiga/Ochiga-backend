import type { UniversalIntent } from "../core/control-plane/contracts/intent.types";

const DOMAIN_PATTERNS: Array<[string, RegExp]> = [
  ["workflow", /workflow|workflows|blocked|overdue/i],
  ["visitor", /visitor|visitors|guest|guests|access pass|visitor approval|visitor access/i],
  ["maintenance", /maintenance|repair|repairs|work order|service ticket/i],
  ["device", /device|devices|light|lights|switch|socket|hardware|relay|ac\b/i],
  ["room", /room|rooms|space|spaces/i],
  ["scene", /scene|scenes/i],
  ["automation", /automation|automations|routine|routines/i],
  ["wallet", /wallet|payment|payments|transaction|transactions|balance|service charge|accounting|finance/i],
  ["service", /service request|services|utility|utilities|water|electric|electricity|internet|fiber|meter|generator|power/i],
  ["community", /community|announcement|announcements|notice|notices|complaint|feedback|moderation|communications/i],
  ["activity", /activity|timeline|who did what|history|audit log/i],
  ["camera", /camera|cameras|cctv|stream|snapshot|edge camera/i],
  ["security", /security|incident|incidents|alarm|gate|access control|breach/i],
  ["infrastructure", /infrastructure|edge node|runtime|stream health|offline infrastructure/i],
  ["sensor", /sensor|sensors|environment|temperature|humidity|air quality/i],
  ["traffic", /traffic|mobility|parking|vehicle flow/i],
  ["staff", /staff|team|operator|operators|technician|cleaner|electrician|mechanic/i],
  ["estate", /estate structure|estate|homes|home list|building|buildings|block|blocks|unit|units/i],
  ["report", /report|reports|daily estate|home summary|estate summary|incident report/i],
  ["notification", /notification|notifications|alert|alerts|digest|push/i],
  ["lead", /lead|leads|proposal|customer|campaign|opportunity|client|support ticket/i],
];

export function classifyUniversalIntent(input: { message: string; surface: UniversalIntent["surface"]; estate_id?: string | null; home_id?: string | null }): UniversalIntent {
  const message = String(input.message || "").trim();
  const lower = message.toLowerCase();
  const domain = DOMAIN_PATTERNS.find(([, pattern]) => pattern.test(lower))?.[0] || "general";
  const intent = /what('?s| is) happening|needs attention|what should i do|everything okay|urgent/.test(lower) ? "awareness"
    : /report|summary|who did what/.test(lower) ? "report"
    : /why|when|who|history|activity|investigate/.test(lower) ? "investigation"
    : /assign/.test(lower) ? "assignment"
    : /approve|reject|revoke|expire|turn on|turn off|toggle|complete|cancel|remove|mark complete|pay|buy|create|invite|add /.test(lower) ? "execution"
    : /show|open|list|any/.test(lower) ? "workflow"
    : /notify|notification|alert/.test(lower) ? "notification"
    : /prediction|forecast|risk/.test(lower) ? "prediction"
    : "analytics";
  const action = /assign/.test(lower) ? "assign"
    : /approve/.test(lower) ? "approve"
    : /reject|revoke|expire|cancel|remove/.test(lower) ? "cancel"
    : /turn on/.test(lower) ? "on"
    : /turn off/.test(lower) ? "off"
    : /toggle/.test(lower) ? "toggle"
    : /complete/.test(lower) ? "complete"
    : /pay|buy|purchase/.test(lower) ? "pay"
    : /create|invite|add /.test(lower) ? "create"
    : /show|open|list|any/.test(lower) ? "list" : "summarize";
  return {
    schemaVersion: "1.0.0", target: "intelligence", reason: "unified_intent_classification", priority: intent === "execution" ? "high" : "normal",
    context: { estate_id: input.estate_id || null, source_signal: "oyi.chat", created_at: new Date().toISOString() },
    surface: input.surface, intent, domain, action,
  };
}
