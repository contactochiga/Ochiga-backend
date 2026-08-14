import type { CanonicalConversationRequest } from "../../contracts/canonicalConversation";
import type { OisContext } from "../../../types/oisContext";
import type { IntelligenceRequestContract } from "../../interpretation/conversationIntentRouting";
import type { OperationalPrediction, OperationalScope } from "../../contracts/intelligence";

export type ProviderContext = {
  input: CanonicalConversationRequest;
  oisContext: OisContext | null | undefined;
  contract: IntelligenceRequestContract;
  scope: OperationalScope;
};

export type ProviderResult = {
  predictions: OperationalPrediction[];
  data_quality: "sufficient" | "limited" | "stale" | "sparse" | "unavailable" | "unsupported";
};

export type PredictionProvider = {
  id: string;
  version: string;
  domains: string[];
  requiredEvidence: string[];
  evaluate: (context: ProviderContext) => Promise<ProviderResult>;
};
