import type { AuthorityDecision } from "./authority";
import type { DomainResult } from "./domainResult";
import type { OyiEvidence } from "./evidence";
import type { ResolvedTurn } from "./resolvedTurn";
import type { SemanticFrame } from "./semanticFrame";
import type { OyiAction } from "./action";
import type { OyiDomain } from "../runtime/languageUnderstanding";
import type { CanonicalConversationRequestContext, ConversationRunResult } from "./conversation";

export type CapabilityRolloutStatus = "declared" | "adapter_ready" | "integration_tested" | "shadow" | "enabled" | "disabled";

export type CapabilityContext = CanonicalConversationRequestContext & {
  resolvedTurn: ResolvedTurn;
  legacyFallback: () => Promise<ConversationRunResult>;
};

export type CapabilityResolution = {
  supported: boolean;
  reason: string | null;
};

export type ExecutionResult = {
  status: string;
  execution_id: string | null;
  provider_status?: string | null;
  metadata?: Record<string, unknown>;
};

export type VerificationResult = {
  verified: boolean;
  status: string;
  evidence_id: string | null;
  metadata?: Record<string, unknown>;
};

export interface CapabilityModule {
  key: string;
  domain: OyiDomain;
  rolloutStatus: CapabilityRolloutStatus;
  supports(frame: SemanticFrame): boolean;
  resolve(context: CapabilityContext): Promise<CapabilityResolution>;
  collectEvidence(context: CapabilityContext): Promise<OyiEvidence[]>;
  buildReadResponse?(context: CapabilityContext, evidence: OyiEvidence[]): Promise<DomainResult | ConversationRunResult>;
  createDraft?(context: CapabilityContext): Promise<DomainResult | ConversationRunResult>;
  authorize?(context: CapabilityContext): Promise<AuthorityDecision>;
  execute?(context: CapabilityContext, action: OyiAction): Promise<ExecutionResult>;
  verify?(context: CapabilityContext, execution: ExecutionResult): Promise<VerificationResult>;
}
