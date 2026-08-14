import type { CanonicalConversationRequest } from "../../contracts/canonicalConversation";
import type { OisContext } from "../../../types/oisContext";
import type { IntelligenceRequestContract } from "../../interpretation/conversationIntentRouting";
import type { ContributorSummary } from "../contributorSummary";
import type { AggregateOperation } from "./aggregateContract";

export type ContributorScope = {
  estate_id: string | null;
  home_id: string | null;
  room_id: string | null;
};

export type ContributorContext = {
  input: CanonicalConversationRequest;
  oisContext: OisContext | null | undefined;
  contract: IntelligenceRequestContract;
  scope: ContributorScope;
  operation: AggregateOperation;
};

export type Contributor = {
  domain: string;
  // Room contributors only run when the domain has a real, evidence-backed
  // room relationship for THIS scope — see roomContributors.ts. Home
  // contributors always support (home-wide is their natural scope).
  supports: (scope: ContributorScope) => boolean;
  contribute: (context: ContributorContext) => Promise<ContributorSummary>;
};
