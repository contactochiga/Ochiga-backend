import type { IntelligenceFact } from "../../contracts/canonicalConversation";
import { buildContributorSummary, type ContributorSeverity } from "../contributorSummary";
import type { Contributor, ContributorContext } from "./contributorTypes";
import { loadHomeDeviceInventoryFacts } from "../devices/deviceEvidence";
import { loadMaintenanceRequestFacts } from "../maintenance/maintenanceEvidence";
import { loadVisitorAccessFacts } from "../visitors/visitorEvidence";
import { loadSecurityIncidentFacts } from "../security/securityEvidence";
import { loadServiceAccountFacts, UTILITY_SERVICE_KEYS } from "../utilities/utilityEvidence";
import { loadServicesActiveFacts } from "../services/serviceEvidence";
import { loadWalletBalanceFacts, loadWalletTransactionFacts } from "../wallet/walletEvidence";
import { loadCommunityPostFacts } from "../community/communityEvidence";
import { loadSceneFacts, loadAutomationFacts, loadAutomationRunFacts } from "../automations/sceneAutomationEvidence";
import { runIntelligenceOrchestrator } from "../intelligence/intelligenceOrchestrator";
import { factFromAnomaly, factFromPrediction, factFromRecommendation } from "../intelligence/intelligenceCapabilities";

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

// Every Home contributor here always "supports" — Home is every domain's
// natural home-wide scope. Room contributors (roomContributors.ts) are the
// ones that gate on a real per-object room relationship.
const alwaysSupports = () => true;

const devicesContributor: Contributor = {
  domain: "devices",
  supports: alwaysSupports,
  contribute: async (context: ContributorContext) => {
    const facts = await loadHomeDeviceInventoryFacts(context.input, context.oisContext);
    return buildContributorSummary({
      domain: "devices",
      facts,
      summary: facts.length ? `${facts.length} device${facts.length === 1 ? "" : "s"} on record.` : "No registered devices found.",
      isAttention: (fact) => recordOf(fact.value).online === false || /offline|unreachable|error/i.test(text(recordOf(fact.value).status)),
      severityFor: (attention) => (attention.length > Math.max(2, facts.length * 0.3) ? "warning" : attention.length ? "attention" : "none"),
    });
  },
};

const maintenanceContributor: Contributor = {
  domain: "maintenance",
  supports: alwaysSupports,
  contribute: async (context: ContributorContext) => {
    const facts = await loadMaintenanceRequestFacts(context.input, context.oisContext, context.contract);
    return buildContributorSummary({
      domain: "maintenance",
      facts,
      summary: facts.length ? `${facts.length} maintenance request${facts.length === 1 ? "" : "s"} on record.` : "No maintenance requests on record.",
      isAttention: (fact) => /open|unresolved|pending|in_progress/i.test(text(recordOf(fact.value).status)),
      severityFor: (attention) => {
        if (!attention.length) return "none";
        const hasHighPriority = attention.some((fact) => /high|urgent/i.test(text(recordOf(fact.value).priority)));
        return hasHighPriority ? "warning" : "attention";
      },
    });
  },
};

const visitorsContributor: Contributor = {
  domain: "visitors",
  supports: alwaysSupports,
  contribute: async (context: ContributorContext) => {
    const facts = await loadVisitorAccessFacts(context.input, context.oisContext, context.contract);
    return buildContributorSummary({
      domain: "visitors",
      facts,
      summary: facts.length ? `${facts.length} visitor access record${facts.length === 1 ? "" : "s"}.` : "No visitor activity on record.",
      isAttention: (fact) => /expected|pending/i.test(text(recordOf(fact.value).status)),
      severityFor: (attention) => (attention.length ? "info" : "none"),
    });
  },
};

const securityContributor: Contributor = {
  domain: "security",
  supports: alwaysSupports,
  contribute: async (context: ContributorContext) => {
    const facts = await loadSecurityIncidentFacts(context.input, context.oisContext, context.contract);
    return buildContributorSummary({
      domain: "security",
      facts,
      summary: facts.length ? `${facts.length} security incident${facts.length === 1 ? "" : "s"} on record.` : "No security incidents on record.",
      isAttention: (fact) => {
        const value = recordOf(fact.value);
        return !/resolved|closed/i.test(text(value.status));
      },
      severityFor: (attention) => {
        if (!attention.length) return "none";
        const severities = attention.map((fact) => text(recordOf(fact.value).severity).toLowerCase());
        if (severities.some((s) => s === "critical" || s === "high")) return "critical";
        return "warning";
      },
    });
  },
};

const utilitiesContributor: Contributor = {
  domain: "utilities",
  supports: alwaysSupports,
  contribute: async (context: ContributorContext) => {
    const facts = await loadServiceAccountFacts(context.input, context.oisContext, context.contract, { onlyServiceKeys: UTILITY_SERVICE_KEYS, domain: "utilities" });
    return buildContributorSummary({
      domain: "utilities",
      facts,
      summary: facts.length ? `${facts.filter((f) => Boolean(recordOf(f.value).active)).length} of ${facts.length} utilities active.` : "No registered utility accounts.",
      isAttention: (fact) => {
        const value = recordOf(fact.value);
        return Boolean(value.enabled) && !value.active;
      },
      severityFor: (attention) => (attention.length ? "attention" : "none"),
    });
  },
};

const servicesContributor: Contributor = {
  domain: "services",
  supports: alwaysSupports,
  contribute: async (context: ContributorContext) => {
    const facts = await loadServicesActiveFacts(context.input, context.oisContext, context.contract);
    return buildContributorSummary({
      domain: "services",
      facts,
      summary: facts.length ? `${facts.filter((f) => Boolean(recordOf(f.value).active)).length} of ${facts.length} services active.` : "No registered services.",
      isAttention: (fact) => {
        const value = recordOf(fact.value);
        return Boolean(value.enabled) && !value.active;
      },
      severityFor: (attention) => (attention.length ? "attention" : "none"),
    });
  },
};

const walletContributor: Contributor = {
  domain: "wallet",
  supports: alwaysSupports,
  contribute: async (context: ContributorContext) => {
    const [balanceFacts, transactionFacts] = await Promise.all([
      loadWalletBalanceFacts(context.input, context.oisContext, context.contract),
      loadWalletTransactionFacts(context.input, context.oisContext, context.contract),
    ]);
    const facts = [...balanceFacts, ...transactionFacts];
    const frozen = balanceFacts.some((fact) => Boolean(recordOf(fact.value).is_frozen));
    return buildContributorSummary({
      domain: "wallet",
      facts,
      // Deliberately does not state the balance here — §45: "Do not expose
      // wallet balance unnecessarily in every Home summary." The balance
      // fact is still available in object_refs for drill-down ("how much
      // is in my wallet?"), just not narrated by default.
      summary: frozen ? "Wallet is currently frozen." : "Wallet is in normal standing.",
      isAttention: (fact) => Boolean(recordOf(fact.value).is_frozen) || text(recordOf(fact.value).status).toLowerCase() === "failed",
      severityFor: (attention) => (attention.length ? "warning" : "none"),
    });
  },
};

const communityContributor: Contributor = {
  domain: "community",
  supports: alwaysSupports,
  contribute: async (context: ContributorContext) => {
    const facts = await loadCommunityPostFacts(context.input, context.oisContext, context.contract);
    const official = facts.filter((fact) => Boolean(recordOf(fact.value).is_official));
    return buildContributorSummary({
      domain: "community",
      facts: official.length ? official : facts,
      summary: official.length ? `${official.length} official update${official.length === 1 ? "" : "s"}.` : "No official community updates.",
      isAttention: (fact) => text(recordOf(fact.value).priority).toLowerCase() === "high" && Boolean(recordOf(fact.value).is_official),
      severityFor: (attention) => (attention.length ? "info" : "none"),
    });
  },
};

const scenesContributor: Contributor = {
  domain: "scenes",
  supports: alwaysSupports,
  contribute: async (context: ContributorContext) => {
    const facts = await loadSceneFacts(context.input, context.oisContext, context.contract);
    return buildContributorSummary({
      domain: "scenes",
      facts,
      summary: facts.length ? `${facts.length} scene${facts.length === 1 ? "" : "s"} configured.` : "No scenes configured.",
    });
  },
};

const automationsContributor: Contributor = {
  domain: "automations",
  supports: alwaysSupports,
  contribute: async (context: ContributorContext) => {
    const [definitionFacts, runFacts] = await Promise.all([
      loadAutomationFacts(context.input, context.oisContext, context.contract),
      loadAutomationRunFacts(context.input, context.oisContext, context.contract),
    ]);
    const recentRuns = runFacts.slice(0, 20);
    const failedRuns = recentRuns.filter((fact) => text(recordOf(fact.value).status).toLowerCase() === "failed");
    return buildContributorSummary({
      domain: "automations",
      facts: [...definitionFacts, ...failedRuns],
      summary: definitionFacts.length ? `${definitionFacts.length} automation${definitionFacts.length === 1 ? "" : "s"} configured.` : "No automations configured.",
      isAttention: (fact) => text(recordOf(fact.value).status).toLowerCase() === "failed",
      severityFor: (attention) => (attention.length > 1 ? "warning" : attention.length ? "attention" : "none"),
    });
  },
};

// Programme 3 — folds anomalies/predictions/recommendations into the Home
// summary as an attention-eligible contributor, same shape as every other
// domain here. Forecasts are deliberately excluded (they belong to the
// explicit forecasts.read capability, not a home-summary attention item —
// a trend is informational, not something needing attention). Never
// persists (persist: false) and never proactively delivers (proactive:
// false) — a plain "how is my home" question must stay a pure read, with
// no side effect of writing rows or sending a notification.
const intelligenceContributor: Contributor = {
  domain: "intelligence",
  supports: alwaysSupports,
  contribute: async (context: ContributorContext) => {
    const result = await runIntelligenceOrchestrator({ input: context.input, oisContext: context.oisContext, contract: context.contract, scope: context.scope, persist: false, proactive: false });
    const facts = [
      ...result.anomalies.map(factFromAnomaly),
      ...result.predictions.map(factFromPrediction),
      ...result.recommendations.map(factFromRecommendation),
    ];
    return buildContributorSummary({
      domain: "intelligence",
      facts,
      summary: facts.length
        ? `${result.anomalies.length} anomaly signal${result.anomalies.length === 1 ? "" : "s"}, ${result.predictions.length} prediction${result.predictions.length === 1 ? "" : "s"}, ${result.recommendations.length} recommendation${result.recommendations.length === 1 ? "" : "s"}.`
        : "No anomalies, predictions, or recommendations right now.",
      isAttention: (fact) => ["warning", "critical"].includes(text(recordOf(fact.value).severity)),
      severityFor: (attention) => {
        if (!attention.length) return "none";
        return attention.some((fact) => text(recordOf(fact.value).severity) === "critical") ? "critical" : "warning";
      },
    });
  },
};

export const HOME_CONTRIBUTORS: Contributor[] = [
  devicesContributor,
  securityContributor,
  maintenanceContributor,
  visitorsContributor,
  utilitiesContributor,
  walletContributor,
  servicesContributor,
  automationsContributor,
  scenesContributor,
  communityContributor,
  intelligenceContributor,
];
