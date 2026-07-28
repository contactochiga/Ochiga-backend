const DEFAULT_TIMEZONE = "Africa/Lagos";
const WEEKDAY_MIN = 0;
const WEEKDAY_MAX = 6;

export type AutomationScheduleTrigger =
  | { type: "schedule"; schedule_type: "daily"; local_time: string; timezone: string }
  | { type: "schedule"; schedule_type: "weekdays"; local_time: string; weekdays: number[]; timezone: string }
  | { type: "schedule"; schedule_type: "once"; local_datetime: string; timezone: string };

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function validTimezone(value: string) {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: weekday >= 0 ? weekday : date.getUTCDay(),
  };
}

function localDateKey(parts: ReturnType<typeof localParts>) {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function offsetMinutesFor(date: Date, timezone: string) {
  const parts = localParts(date, timezone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

function zonedLocalToUtc(local: { year: number; month: number; day: number; hour: number; minute: number; second?: number }, timezone: string) {
  const guess = new Date(Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second || 0));
  const offset = offsetMinutesFor(guess, timezone);
  const first = new Date(guess.getTime() - offset * 60000);
  const adjustedOffset = offsetMinutesFor(first, timezone);
  return new Date(guess.getTime() - adjustedOffset * 60000);
}

function parseLocalTime(value: string) {
  const match = String(value || "").match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function parseLocalDateTime(value: string) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6] || 0) };
}

export function validateAutomationTrigger(input: any): { ok: true; trigger: AutomationScheduleTrigger; timezone: string } | { ok: false; error: string; code: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Automation trigger is required.", code: "automation_trigger_required" };
  const timezone = String(input.timezone || DEFAULT_TIMEZONE).trim();
  if (!validTimezone(timezone)) return { ok: false, error: "Automation timezone must be a valid IANA timezone.", code: "invalid_automation_timezone" };
  if (String(input.type) !== "schedule") return { ok: false, error: "Only scheduled automations are supported in this phase.", code: "unsupported_automation_trigger" };
  const scheduleType = String(input.schedule_type || "");
  if (scheduleType === "daily") {
    if (!parseLocalTime(input.local_time)) return { ok: false, error: "Daily automations require a valid local time.", code: "invalid_automation_time" };
    return { ok: true, timezone, trigger: { type: "schedule", schedule_type: "daily", local_time: String(input.local_time), timezone } };
  }
  if (scheduleType === "weekdays") {
    if (!parseLocalTime(input.local_time)) return { ok: false, error: "Weekday automations require a valid local time.", code: "invalid_automation_time" };
    const weekdays: number[] = Array.from(new Set<number>((Array.isArray(input.weekdays) ? input.weekdays : [])
      .map((day: unknown) => Number(day))
      .filter((day: number) => Number.isInteger(day) && day >= WEEKDAY_MIN && day <= WEEKDAY_MAX)))
      .sort((a, b) => a - b);
    if (!weekdays.length) return { ok: false, error: "Select at least one weekday.", code: "invalid_automation_weekdays" };
    return { ok: true, timezone, trigger: { type: "schedule", schedule_type: "weekdays", local_time: String(input.local_time), weekdays, timezone } };
  }
  if (scheduleType === "once") {
    const parsed = parseLocalDateTime(input.local_datetime);
    if (!parsed) return { ok: false, error: "One-time automations require a valid local date and time.", code: "invalid_automation_datetime" };
    return { ok: true, timezone, trigger: { type: "schedule", schedule_type: "once", local_datetime: String(input.local_datetime), timezone } };
  }
  return { ok: false, error: "Unsupported automation schedule type.", code: "unsupported_automation_schedule" };
}

export function nextAutomationRunAt(trigger: AutomationScheduleTrigger, from: Date = new Date()): Date | null {
  if (trigger.schedule_type === "once") {
    const parsed = parseLocalDateTime(trigger.local_datetime);
    if (!parsed) return null;
    const next = zonedLocalToUtc(parsed, trigger.timezone);
    return next.getTime() > from.getTime() ? next : null;
  }
  const localTime = parseLocalTime(trigger.local_time);
  if (!localTime) return null;
  const current = localParts(from, trigger.timezone);
  for (let offset = 0; offset <= 8; offset += 1) {
    const baseUtc = zonedLocalToUtc({ year: current.year, month: current.month, day: current.day, hour: 12, minute: 0 }, trigger.timezone);
    const candidateBase = new Date(baseUtc.getTime() + offset * 86400000);
    const candidateLocal = localParts(candidateBase, trigger.timezone);
    if (trigger.schedule_type === "weekdays" && !trigger.weekdays.includes(candidateLocal.weekday)) continue;
    const candidate = zonedLocalToUtc({ year: candidateLocal.year, month: candidateLocal.month, day: candidateLocal.day, hour: localTime.hour, minute: localTime.minute }, trigger.timezone);
    if (candidate.getTime() > from.getTime()) return candidate;
  }
  return null;
}

export function automationOccurrenceKey(automationId: string, scheduledFor: string | Date, source: "scheduled" | "manual_test", explicit?: string | null) {
  if (source === "manual_test") return explicit && /^[a-zA-Z0-9:_-]{8,160}$/.test(explicit) ? explicit : `manual:${cryptoRandom()}`;
  const date = scheduledFor instanceof Date ? scheduledFor : new Date(scheduledFor);
  return `schedule:${automationId}:${date.toISOString()}`;
}

function cryptoRandom() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function humanSchedule(trigger: any) {
  const parsed = validateAutomationTrigger(trigger);
  if (!parsed.ok) return "Unsupported schedule";
  const t = parsed.trigger;
  if (t.schedule_type === "daily") return `Daily at ${t.local_time}`;
  if (t.schedule_type === "weekdays") return `Selected days at ${t.local_time}`;
  return `Once at ${t.local_datetime.replace("T", " ")}`;
}
