import type { CanonicalConversationRequest } from "../../contracts/canonicalConversation";
import type { OisContext } from "../../../types/oisContext";
import type { IntelligenceRequestContract } from "../../interpretation/conversationIntentRouting";
import type { OperationalAnomaly, OperationalScope } from "../../contracts/intelligence";

export type DetectorContext = {
  input: CanonicalConversationRequest;
  oisContext: OisContext | null | undefined;
  contract: IntelligenceRequestContract;
  scope: OperationalScope;
};

export type DetectorResult = {
  anomalies: OperationalAnomaly[];
  // Honest data-quality signal even when zero anomalies were found — "I
  // checked and found nothing" is different from "I could not check".
  data_quality: "sufficient" | "limited" | "stale" | "sparse" | "unavailable" | "unsupported";
  evidence_count: number;
};

// Stable identity + version required for evaluation/backtesting (§56) — a
// detector's output must be traceable to exactly which rule/version
// produced it.
export type AnomalyDetector = {
  id: string;
  version: string;
  domain: string;
  detect: (context: DetectorContext) => Promise<DetectorResult>;
};
