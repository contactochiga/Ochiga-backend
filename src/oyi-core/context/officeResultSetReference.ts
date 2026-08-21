// Oyi Conversational Runtime Completion Programme, Phase 4, PR 3 --
// Office-specific reference resolution.
//
// resultSetContext.ts / followUpResolver.ts (parseFollowUpIntent,
// resolveFollowUpReference, resolveFilterFollowUp, ambiguous-candidate
// formatting) are already fully domain-agnostic and reused here AS-IS --
// they operate only on ResultSetContext/ResultSetObjectRef, with no
// Consumer/Facility-specific logic. attemptFollowUpResolution
// (ConversationOrchestrator.ts) already runs unconditionally for every
// surface; office_internal turns already reach it today, but every
// ordinal/pronoun resolution that narrows to exactly ONE object falls
// through to resolveAndHydrateSingleObject's hydrateCanonicalTarget() --
// a device/room hydration registry with no path into Office's tables
// (same "Backend has no DB access to Office's tables" constraint as
// Phases 2-3's officeConversationContext.ts / officeActionProposal.ts).
//
// Fix, same architectural pattern as those two files: reuse the shared
// TYPES, write a parallel continuation for the one execution step that
// doesn't fit. No re-hydration is actually needed here -- the
// ResultSetObjectRef already carries everything the original list turn
// (office_tasks.query.read) put there (label/status/attributes), so
// this just formats an answer directly from data already vouched for,
// rather than re-fetching it.
import type { IntelligenceFact } from "../contracts/canonicalConversation";
import type { ResultSetObjectRef } from "./resultSetContext";
import type { FollowUpIntent } from "../interpretation/followUpResolver";

function text(value: unknown) {
  return String(value ?? "").trim();
}

// Every office_* domain this codebase's classifyDomain() produces
// (languageUnderstanding.ts) is a corporate-record domain with no
// Consumer/Facility hydration path -- Tasks is the only one with a list
// capability today (Phase 4 PR 2), but this check is domain-shaped, not
// task-shaped, so Milestone 2's Automations/Meetings/Support list
// capabilities plug into the SAME continuation without touching this
// file again.
export function isOfficeResultSetDomain(domain: string): boolean {
  return domain.startsWith("office_") || domain === "crm";
}

function humanizeStatus(status: string | null): string | null {
  if (!status) return null;
  return status.replace(/_/g, " ");
}

// Builds an IntelligenceFact directly from the already-persisted ref --
// no live re-fetch. truth_state is deliberately "observed" (not
// "confirmed"): this is the SAME data Office vouched for on the list
// turn, carried forward, not a fresh read.
export function officeFactFromRef(ref: ResultSetObjectRef): IntelligenceFact {
  return {
    fact_id: `office_result_set_ref:${ref.object_type}:${ref.canonical_id}`,
    domain: "office_tasks",
    fact_type: `${ref.object_type}_detail`,
    scope: { estate_id: null, building_id: null, home_id: null, room_id: null },
    object: { object_type: ref.object_type, canonical_id: ref.canonical_id, label: ref.label },
    statement: ref.label,
    value: { status: ref.status, ...ref.attributes },
    previous_value: null,
    occurred_at: ref.occurred_at,
    observed_at: new Date().toISOString(),
    source_type: "database",
    source_id: ref.canonical_id,
    truth_state: "observed",
    confidence: 0.85,
    freshness: "unknown",
    privacy_class: "corporate_private",
    permissions: [],
    evidence: [],
  };
}

// Generic across every office_* object type today (just "task"), same
// restrained honesty discipline as officeTasksReadModule's own answer()
// branches: only ever states a field if the ref actually carries it.
export function officeFollowUpAnswer(ref: ResultSetObjectRef, intent: FollowUpIntent): string {
  const label = text(ref.label) || "That item";
  const status = humanizeStatus(ref.status);
  const owner = text(ref.attributes.owner) || null;
  const dueAt = text(ref.attributes.due_at) || null;
  const overdue = ref.attributes.overdue === "true";
  const priority = text(ref.attributes.priority) || null;

  if (intent.type === "field" && intent.field === "who") {
    return owner ? `${label} is owned by ${owner}.` : `${label} doesn't have an owner assigned yet.`;
  }
  if (intent.type === "field" && intent.field === "when") {
    if (!dueAt) return `${label} doesn't have a due date set.`;
    return `${label} is due ${dueAt}${overdue ? " — it's overdue." : "."}`;
  }
  if (intent.type === "status_check") {
    return `${label} is ${status || "in an unknown status"}${overdue ? ", and it's overdue" : ""}.`;
  }

  const parts = [label];
  if (status) parts.push(status);
  if (priority) parts.push(`${priority} priority`);
  if (owner) parts.push(`owned by ${owner}`);
  if (dueAt) parts.push(`due ${dueAt}${overdue ? " (overdue)" : ""}`);
  return parts.join(" — ");
}
