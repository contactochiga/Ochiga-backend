import type { OyiDomain } from "../runtime/languageUnderstanding";

export type SemanticOperation =
  | "inform"
  | "summarize"
  | "list"
  | "inspect"
  | "navigate"
  | "compose"
  | "clarify"
  | "approve"
  | "reject"
  | "cancel"
  | "device.power.on"
  | "device.power.off"
  | "device.availability"
  | "device.status"
  | "device.activity"
  | "device.failures"
  | "device.diagnosis"
  | "device.relationships"
  | "wallet.history"
  | "utilities.spending"
  | "utilities.active"
  | "utilities.usage"
  | "utilities.balance"
  | "utilities.meter";

export type SemanticEntity = {
  type: "device" | "room" | "wallet" | "utility" | "visitor" | "maintenance" | "message" | "scene" | "automation" | "camera" | "unknown";
  text: string;
  normalizedText: string;
  confidence: number;
};

export type SemanticConstraint = {
  type: "room" | "channel" | "temporal" | "scope" | "domain";
  text: string;
  normalizedText: string;
  confidence: number;
};

export type SemanticFrame = {
  rawText: string;
  normalizedText: string;
  operation: SemanticOperation;
  domain: OyiDomain | null;
  primaryEntity: SemanticEntity | null;
  constraints: SemanticConstraint[];
  temporalScope: {
    mode: "current" | "recent" | "today" | "yesterday" | "current_month" | "range" | "history";
    from: string | null;
    to: string | null;
  } | null;
  references: Array<{ phrase: string; kind: "pronoun" | "same_target" | "other_candidate" | "candidate_reply"; confidence: number }>;
  confidence: number;
  ambiguity: {
    required: boolean;
    reason: string | null;
    candidates: Array<Record<string, unknown>>;
  };
  corrections: Array<{ original: string; normalized: string; confidence: number }>;
  mutationIntent: boolean;
};
