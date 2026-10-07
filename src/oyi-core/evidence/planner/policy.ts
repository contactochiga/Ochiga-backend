import type { Requirement } from "./types";

// Deterministic requirement policy. Inputs are ONLY the IQ-2 assessment context fields (objective,
// subject domains, surface) -- the original prompt is never re-interpreted here. IQ-3A's mandatory /
// optional classification, which was judged from frozen evaluation envelopes, is expressed here as a
// runtime rule keyed on those fields.
//
// A "broad" subject is the surface's default subject (the user asked about the whole area); an
// explicit subject (the user named a domain) is mandatory by definition.

const DOMAIN_CLASS: Record<string, string[]> = {
  crm: ["crm"], office_development: ["office_development"], office_reports: ["office_reports"], office_financial: ["office_financial"],
  office_tasks: ["office_tasks"], office_meetings: ["office_meetings"], office_support: ["office_support"], office_portfolio: ["office_portfolio"],
  office_partnerships: ["office_partnerships"], office_documents: ["office_documents"], office_content: ["office_content"],
  automations: ["office_automations"],
  corporate_opportunity: ["corporate_opportunity"], corporate_development: ["corporate_development"], corporate_partnerships: ["corporate_partnerships"],
  maintenance: ["maintenance"], security: ["security"], visitors: ["visitors"], cameras: ["cameras"],
  devices: ["device_availability"], rooms: ["device_availability"],
  utilities: ["utilities_usage"], wallet: ["wallet"], scenes: ["scenes"],
};

type Broad = { mandatory: string[]; optional: string[] };
const ATTENTION_OBJECTIVES = new Set(["assess", "prioritize", "advise"]);
const FRAMING_OBJECTIVES = new Set(["assess", "compare", "advise", "explain"]);

export function broadPolicy(surface: string, objective: string): Broad {
  if (surface === "office_internal") {
    return {
      mandatory: ["crm", "office_development", "office_reports", "office_financial"],
      // Operational queues that make "what needs attention" meaningful; opt-in by objective, not by capacity.
      optional: ATTENTION_OBJECTIVES.has(objective) ? ["office_tasks", "office_support", "office_meetings"] : [],
    };
  }
  if (surface === "facility") return { mandatory: ["maintenance", "security", "cameras"], optional: ["visitors", "device_availability", "utilities_service"] };
  if (surface === "consumer") return { mandatory: ["device_availability", "security", "visitors"], optional: ["maintenance", "scenes", "utilities_service", "cameras", "device_observed_value"] };
  if (surface === "public_corporate") return { mandatory: ["corporate_opportunity"], optional: FRAMING_OBJECTIVES.has(objective) ? ["corporate_partnerships"] : [] };
  return { mandatory: [], optional: [] };
}

export function deriveRequirements(input: { surface: string; objective: string; subject_domains: string[]; broad: boolean }): { requirements: Requirement[]; notes: string[] } {
  const notes: string[] = [];
  const out = new Map<string, Requirement>();
  const add = (cls: string, necessity: Requirement["necessity"], reason: string) => {
    const existing = out.get(cls);
    if (!existing || (existing.necessity === "optional" && necessity === "mandatory")) out.set(cls, { class: cls, necessity, reason });
  };
  const domains = input.subject_domains;
  const homeOnly = domains.length === 1 && domains[0] === "home";
  if (input.broad || homeOnly) {
    const policy = broadPolicy(input.surface, input.objective);
    for (const c of policy.mandatory) add(c, "mandatory", homeOnly ? "composite home subject expanded to its direct sources" : "default subject of the surface");
    for (const c of policy.optional) add(c, "optional", "objective-gated companion of the default subject");
    if (homeOnly) notes.push("composite_expanded_to_direct_sources");
    return { requirements: [...out.values()], notes };
  }
  for (const d of domains) {
    if (d === "home") { // composite alongside explicit subjects: direct components are optional context, never duplicates
      for (const c of broadPolicy(input.surface, input.objective).mandatory) add(c, "optional", "direct component of the composite home subject");
      notes.push("composite_expanded_to_direct_sources");
      continue;
    }
    const classes = DOMAIN_CLASS[d];
    if (!classes) { add(`domain:${d}`, "mandatory", `explicit subject ${d} has no evidence class`); continue; }
    for (const c of classes) add(c, "mandatory", `explicit subject ${d}`);
  }
  if (input.surface === "public_corporate" && domains.includes("corporate_opportunity") && FRAMING_OBJECTIVES.has(input.objective)) {
    // The public development listing is a network source: it is gathered only when the subject names developments.
    add("corporate_partnerships", "optional", "approved public framing for an opportunity assessment");
  }
  if (domains.includes("devices") || domains.includes("rooms")) {
    // Disclosure companion: assessing devices must say that physical values (temperature, lock, power) are not readable.
    if (input.surface === "consumer") add("device_observed_value", "optional", "device assessments must disclose that observed physical values are not readable");
    if (["explain", "reassess"].includes(input.objective)) add("device_history", "optional", "explaining or reassessing device behaviour benefits from recent activity");
  }
  return { requirements: [...out.values()], notes };
}
