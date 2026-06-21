import type { LanguageTeacherDomain, LanguageTeacherIntent, LanguageTeacherProvider, LanguageTeacherResult } from "./providerRegistry";

const DOMAIN_PATTERNS: Array<{ domain: LanguageTeacherDomain; intent: LanguageTeacherIntent; normalized: string; patterns: RegExp[] }> = [
  { domain: "visitors", intent: "visitor_operation", normalized: "show visitor access", patterns: [/guest/i, /gate\s*(pass|code)/i, /who(?:'s| is) (?:coming|visiting|at (?:my )?(?:home|house))/i, /visitor/i, /access\s*(request|approval|code)/i] },
  { domain: "maintenance", intent: "maintenance_operation", normalized: "show maintenance requests", patterns: [/repair/i, /fault/i, /broken/i, /work\s*order/i, /maintenance/i, /technician/i] },
  { domain: "devices", intent: "device_status", normalized: "show devices", patterns: [/device/i, /light/i, /switch/i, /socket/i, /appliance/i, /relay/i, /ac\b/i] },
  { domain: "wallet", intent: "wallet_operation", normalized: "show wallet", patterns: [/wallet/i, /balance/i, /payment/i, /transaction/i, /dues/i, /levy/i, /charge/i, /receipt/i, /\bowe\b/i, /outstanding/i, /how much/i] },
  { domain: "services", intent: "service_operation", normalized: "show services", patterns: [/service/i, /fiber/i, /internet/i, /water/i, /electricity/i, /utility/i, /meter/i] },
  { domain: "community", intent: "community_operation", normalized: "show community updates", patterns: [/community/i, /notice/i, /announcement/i, /complaint/i, /feedback/i] },
  { domain: "notifications", intent: "notification_operation", normalized: "show notifications", patterns: [/notification/i, /alert/i] },
  { domain: "activity", intent: "investigation", normalized: "show activity", patterns: [/activity/i, /timeline/i, /who did what/i, /log/i] },
  { domain: "security", intent: "investigation", normalized: "show security status", patterns: [/security/i, /incident/i, /alarm/i, /gate/i, /access control/i] },
  { domain: "rooms", intent: "general_help", normalized: "show rooms", patterns: [/room/i, /space/i] },
  { domain: "scenes", intent: "general_help", normalized: "show scenes", patterns: [/scene/i] },
  { domain: "automation", intent: "general_help", normalized: "show automation", patterns: [/automation/i, /routine/i] },
  { domain: "cameras", intent: "device_status", normalized: "show camera events", patterns: [/camera/i, /cctv/i] },
  { domain: "infrastructure", intent: "device_status", normalized: "show infrastructure", patterns: [/infrastructure/i, /edge/i, /runtime/i, /stream/i] },
  { domain: "reports", intent: "report_generation", normalized: "show reports", patterns: [/report/i, /audit/i, /summary/i] },
  { domain: "workflows", intent: "investigation", normalized: "show workflows", patterns: [/workflow/i, /task queue/i] },
  { domain: "operational_queue", intent: "investigation", normalized: "open most recent requests", patterns: [/operator request/i, /work queue/i, /most important issue/i, /recent request/i] },
  { domain: "awareness", intent: "awareness", normalized: "what needs attention", patterns: [/what needs attention/i, /what should i do/i, /what'?s happening/i, /everything okay/i] },
];

export function cleanPhrase(phrase: string) {
  return String(phrase || "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9'\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function localNormalizePhrase(phrase: string): LanguageTeacherResult | null {
  const clean = cleanPhrase(phrase);
  if (!clean) return null;
  const matches = DOMAIN_PATTERNS.map((entry) => {
    const score = entry.patterns.reduce((total, pattern) => total + (pattern.test(clean) ? 1 : 0), 0);
    return { entry, score };
  }).filter((row) => row.score > 0).sort((a, b) => b.score - a.score);
  const best = matches[0];
  if (!best) return null;
  const confidence = Math.min(0.95, 0.55 + best.score * 0.15);
  return {
    domain: best.entry.domain,
    intent: best.entry.intent,
    entities: [],
    confidence,
    normalized_phrase: best.entry.normalized,
    provider: "local",
  };
}

export class LocalAdapter implements LanguageTeacherProvider {
  name = "local" as const;
  async interpret(input: { phrase: string }) {
    return localNormalizePhrase(input.phrase);
  }
}

export function normalizeLanguageTeacherResult(result: LanguageTeacherResult | null): LanguageTeacherResult | null {
  if (!result) return null;
  const confidence = Math.max(0, Math.min(1, Number(result.confidence || 0)));
  if (!result.normalized_phrase || !result.domain || !result.intent) return null;
  return { ...result, confidence, entities: Array.isArray(result.entities) ? result.entities.slice(0, 10) : [] };
}

export const LANGUAGE_TEACHER_DOMAINS = DOMAIN_PATTERNS.map((entry) => entry.domain);
