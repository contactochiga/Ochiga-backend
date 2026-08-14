import { logger } from "../../../observability/logger";
import { unavailableContributorSummary, type ContributorSummary } from "../contributorSummary";
import type { Contributor, ContributorContext } from "./contributorTypes";
import {
  attentionItemsFromContributor,
  coverageFromContributors,
  dedupeAttentionItems,
  factsFromContributors,
  maxSeverity,
  objectRefsFromContributors,
  overallStateFor,
  type AggregateResult,
} from "./aggregateContract";

export type AggregateRunResult = {
  contributors: ContributorSummary[];
  latencyByDomain: Record<string, number>;
  aggregateLatencyMs: number;
};

// Runs every contributor that supports this scope, in parallel, with
// per-contributor failure isolation (§31: one contributor throwing must
// never fail the whole Room/Home answer) and per-domain latency capture
// (§52/§54). No contributor re-queries another's evidence — each one calls
// its own Programme 1 loader exactly once.
export async function runContributors(contributors: Contributor[], context: ContributorContext): Promise<AggregateRunResult> {
  const startedAt = Date.now();
  const applicable = contributors.filter((contributor) => contributor.supports(context.scope));
  const latencyByDomain: Record<string, number> = {};
  const results = await Promise.all(applicable.map(async (contributor) => {
    const contributorStartedAt = Date.now();
    try {
      const summary = await contributor.contribute(context);
      latencyByDomain[contributor.domain] = Date.now() - contributorStartedAt;
      return summary;
    } catch (error) {
      latencyByDomain[contributor.domain] = Date.now() - contributorStartedAt;
      logger.warn("oyi_room_home_contributor_failed", {
        domain: contributor.domain,
        operation: context.operation,
        estate_id: context.scope.estate_id,
        home_id: context.scope.home_id,
        room_id: context.scope.room_id,
        error: error instanceof Error ? error.message : String(error),
      });
      return unavailableContributorSummary(contributor.domain, "contributor_exception");
    }
  }));
  return { contributors: results, latencyByDomain, aggregateLatencyMs: Date.now() - startedAt };
}

export function composeAggregateResult(input: {
  scopeType: "home" | "room";
  scopeRef: { estate_id: string | null; home_id: string | null; room_id: string | null; label: string };
  operation: AggregateResult["operation"];
  contributors: ContributorSummary[];
  summaryText: string;
}): AggregateResult {
  const { contributors } = input;
  const coverage = coverageFromContributors(contributors);
  const attentionItems = dedupeAttentionItems(contributors.flatMap(attentionItemsFromContributor));
  const overallSeverity = maxSeverity(contributors.map((c) => c.severity));
  const overallState = overallStateFor(overallSeverity, coverage);
  const status: AggregateResult["status"] = coverage.answered + coverage.empty === 0
    ? "unavailable"
    : (coverage.degraded + coverage.unavailable > 0 ? "partial" : "answered");
  return {
    scope_type: input.scopeType,
    scope_ref: input.scopeRef,
    operation: input.operation,
    status,
    coverage,
    contributors,
    attention_items: attentionItems,
    facts: factsFromContributors(contributors),
    object_refs: objectRefsFromContributors(contributors),
    overall_severity: overallSeverity,
    overall_state: overallState,
    summary: input.summaryText,
  };
}
