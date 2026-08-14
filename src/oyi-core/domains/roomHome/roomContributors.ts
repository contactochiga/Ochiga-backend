import { buildContributorSummary } from "../contributorSummary";
import type { Contributor, ContributorContext, ContributorScope } from "./contributorTypes";
import { loadHomeDeviceInventoryFacts } from "../devices/deviceEvidence";
import { loadMaintenanceRequestFacts } from "../maintenance/maintenanceEvidence";
import { loadSecurityIncidentFacts } from "../security/securityEvidence";

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

// Only domains with a REAL room_id relationship in the schema get a Room
// contributor (see the Programme 2 legacy/schema audit): devices (real FK,
// already room-filterable), maintenance (real column, now selected —
// previously ignored by the evidence loader), and security incidents (real
// column, already selected). Visitors/wallet/utilities/services/community
// have no room relationship in the schema and are deliberately NOT room
// contributors — see §4/§41/§45 ("do not force domains into Room where
// there is no meaningful room relationship"). Scenes/automations have no
// room_id column either (home-scoped only at the DB level) and are
// similarly omitted rather than fabricating relevance from device-target
// JSON — a documented, honest gap (see OYI_ROOM_INTELLIGENCE.md).
function roomIdRequired(scope: ContributorScope) {
  return Boolean(scope.room_id);
}

const devicesRoomContributor: Contributor = {
  domain: "devices",
  supports: roomIdRequired,
  contribute: async (context: ContributorContext) => {
    // loadHomeDeviceInventoryFacts already filters by input.room_id when
    // present (deviceEvidence.ts) — native room filtering, not a second
    // query path.
    const facts = await loadHomeDeviceInventoryFacts({ ...context.input, room_id: context.scope.room_id }, context.oisContext);
    return buildContributorSummary({
      domain: "devices",
      facts,
      summary: facts.length ? `${facts.length} device${facts.length === 1 ? "" : "s"} registered in this room.` : "No devices registered in this room.",
      isAttention: (fact) => recordOf(fact.value).online === false || /offline|unreachable|error/i.test(text(recordOf(fact.value).status)),
      severityFor: (attention) => (attention.length ? "attention" : "none"),
    });
  },
};

const maintenanceRoomContributor: Contributor = {
  domain: "maintenance",
  supports: roomIdRequired,
  contribute: async (context: ContributorContext) => {
    const allFacts = await loadMaintenanceRequestFacts(context.input, context.oisContext, context.contract);
    const facts = allFacts.filter((fact) => fact.truth_state === "unavailable" || fact.scope?.room_id === context.scope.room_id);
    return buildContributorSummary({
      domain: "maintenance",
      facts,
      summary: facts.length ? `${facts.length} maintenance request${facts.length === 1 ? "" : "s"} linked to this room.` : "No maintenance requests linked to this room.",
      isAttention: (fact) => /open|unresolved|pending|in_progress/i.test(text(recordOf(fact.value).status)),
      severityFor: (attention) => {
        if (!attention.length) return "none";
        const hasHighPriority = attention.some((fact) => /high|urgent/i.test(text(recordOf(fact.value).priority)));
        return hasHighPriority ? "warning" : "attention";
      },
    });
  },
};

const securityRoomContributor: Contributor = {
  domain: "security",
  supports: roomIdRequired,
  contribute: async (context: ContributorContext) => {
    const allFacts = await loadSecurityIncidentFacts(context.input, context.oisContext, context.contract);
    const facts = allFacts.filter((fact) => fact.truth_state === "unavailable" || fact.scope?.room_id === context.scope.room_id);
    return buildContributorSummary({
      domain: "security",
      facts,
      summary: facts.length ? `${facts.length} security incident${facts.length === 1 ? "" : "s"} linked to this room.` : "No security incidents linked to this room.",
      isAttention: (fact) => !/resolved|closed/i.test(text(recordOf(fact.value).status)),
      severityFor: (attention) => {
        if (!attention.length) return "none";
        const severities = attention.map((fact) => text(recordOf(fact.value).severity).toLowerCase());
        if (severities.some((s) => s === "critical" || s === "high")) return "critical";
        return "warning";
      },
    });
  },
};

export const ROOM_CONTRIBUTORS: Contributor[] = [
  devicesRoomContributor,
  maintenanceRoomContributor,
  securityRoomContributor,
];
