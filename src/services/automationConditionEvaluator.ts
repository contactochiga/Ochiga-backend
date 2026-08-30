// Facility Automation -- Cross-Domain Fabric Closure.
//
// The smallest canonical condition engine necessary for the required test
// flows -- not a generic expression language. Five typed condition kinds,
// each either a pure computation over the firing event, or a single cheap,
// real DB read (never arbitrary client-supplied "truth"). This is what
// makes "WHEN outdoor temp > 35 IF Building A is occupied AND indoor temp >
// 28" genuinely constructible rather than only illustrative.
import { supabaseAdmin } from "../supabase/supabaseClient";

export type AutomationCondition =
  | { type: "severity_at_least"; severity: "info" | "attention" | "warning" | "critical" }
  | { type: "field_threshold"; field: string; op: "gte" | "lte"; value: number }
  | { type: "time_window"; start: string; end: string; timezone?: string }
  | { type: "building_occupied"; building_id: string; occupied: boolean }
  | { type: "indoor_sensor_threshold"; home_id: string; metric: "temperature" | "humidity"; op: "gte" | "lte"; value: number };

export type FiringEvent = {
  estate_id: string | null;
  home_id: string | null;
  severity: string | null;
  metadata: { payload?: Record<string, unknown> | null } | null;
  occurred_at: string;
};

const SEVERITY_RANK: Record<string, number> = { info: 0, attention: 1, warning: 2, critical: 3 };

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

async function isBuildingOccupied(buildingId: string): Promise<boolean> {
  const { data: homes } = await supabaseAdmin.from("homes").select("id").eq("building_id", buildingId);
  const homeIds = (homes || []).map((h: any) => String(h.id));
  if (!homeIds.length) return false;
  const { count } = await supabaseAdmin
    .from("home_memberships")
    .select("id", { count: "exact", head: true })
    .in("home_id", homeIds)
    .eq("status", "active");
  return Boolean(count && count > 0);
}

const METRIC_PATTERN: Record<"temperature" | "humidity", RegExp> = {
  temperature: /temperature|temp_current|va_temperature/i,
  humidity: /humidity|humid/i,
};

async function latestIndoorReading(homeId: string, metric: "temperature" | "humidity"): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from("utility_telemetry")
    .select("value, utility_type, metric, type, observed_at")
    .eq("home_id", homeId)
    .order("observed_at", { ascending: false })
    .limit(50);
  const pattern = METRIC_PATTERN[metric];
  const match = (data || []).find((row: any) => pattern.test(`${row.utility_type || ""} ${row.metric || ""} ${row.type || ""}`));
  return match ? num((match as any).value) : null;
}

export async function evaluateAutomationConditions(conditions: AutomationCondition[], event: FiringEvent): Promise<{ ok: boolean; reason?: string }> {
  for (const condition of conditions) {
    if (condition.type === "severity_at_least") {
      const eventRank = SEVERITY_RANK[String(event.severity || "info")] ?? 0;
      const requiredRank = SEVERITY_RANK[condition.severity] ?? 0;
      if (eventRank < requiredRank) return { ok: false, reason: `severity ${event.severity || "info"} below required ${condition.severity}` };
      continue;
    }
    if (condition.type === "field_threshold") {
      const value = num(event.metadata?.payload?.[condition.field]);
      if (value === null) return { ok: false, reason: `field ${condition.field} not present on event` };
      const pass = condition.op === "gte" ? value >= condition.value : value <= condition.value;
      if (!pass) return { ok: false, reason: `${condition.field}=${value} does not satisfy ${condition.op} ${condition.value}` };
      continue;
    }
    if (condition.type === "time_window") {
      const now = new Date(event.occurred_at);
      const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
      const [startH, startM] = condition.start.split(":").map(Number);
      const [endH, endM] = condition.end.split(":").map(Number);
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;
      const inWindow = startMinutes <= endMinutes ? minutes >= startMinutes && minutes <= endMinutes : minutes >= startMinutes || minutes <= endMinutes;
      if (!inWindow) return { ok: false, reason: "outside configured time window" };
      continue;
    }
    if (condition.type === "building_occupied") {
      const occupied = await isBuildingOccupied(condition.building_id);
      if (occupied !== condition.occupied) return { ok: false, reason: `building occupancy is ${occupied}, required ${condition.occupied}` };
      continue;
    }
    if (condition.type === "indoor_sensor_threshold") {
      const value = await latestIndoorReading(condition.home_id, condition.metric);
      if (value === null) return { ok: false, reason: `no indoor ${condition.metric} reading available for home` };
      const pass = condition.op === "gte" ? value >= condition.value : value <= condition.value;
      if (!pass) return { ok: false, reason: `indoor ${condition.metric}=${value} does not satisfy ${condition.op} ${condition.value}` };
      continue;
    }
  }
  return { ok: true };
}
