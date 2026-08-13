import type { AuthorityDecision } from "./authority";
import type { DomainResult } from "./domainResult";
import type { OyiEvidence } from "./evidence";
import type { ResolvedTurn } from "./resolvedTurn";
import type { SemanticFrame } from "./semanticFrame";
import type { OyiAction } from "./action";
import type { OyiDomain } from "../runtime/languageUnderstanding";
import type { CanonicalConversationRequestContext, ConversationRunResult } from "./conversation";
import type { WorkflowStatus } from "./workflow";
import type { OyiSurface } from "../../services/oyiUnifiedIntelligenceService";

export type CapabilityRolloutStatus = "declared" | "implemented" | "adapter_ready" | "integration_tested" | "shadow" | "enabled" | "disabled";
export type CapabilityRiskClass = "read" | "low_risk_action" | "consequential_action" | "sensitive_action" | "secure_handoff_only";
export type ConfirmationPolicy = "none" | "review" | "explicit_confirmation" | "secure_review" | "handoff_required";

export type ScopeRequirement = {
  scope: "global" | "estate" | "building" | "home" | "room" | "target" | "public_session" | "office_context";
  required: boolean;
};

export type EvidenceRequirement = {
  domain: OyiDomain | "unknown";
  evidence_type: string;
  freshness: Array<OyiEvidence["freshness"]>;
  required: boolean;
};

export type WorkflowDefinition = {
  workflow_key: string;
  initial_status: WorkflowStatus;
  terminal_statuses: WorkflowStatus[];
  requires_durable_state: boolean;
};

export type CapabilityPresentationPolicy = {
  primary: "text" | "list" | "table" | "detail" | "clarification" | "review" | "approval" | "execution" | "navigation" | "handoff" | "error";
  expose_evidence: "hidden" | "summary" | "detailed";
  allow_internal_ids: boolean;
};

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

export type CapabilityResolver = (context: CapabilityContext) => Promise<CapabilityResolution>;
export type CapabilityReadHandler = (context: CapabilityContext, evidence: OyiEvidence[]) => Promise<DomainResult | ConversationRunResult>;
export type CapabilityDraftHandler = (context: CapabilityContext) => Promise<DomainResult | ConversationRunResult>;
export type CapabilityExecuteHandler = (context: CapabilityContext, action: OyiAction) => Promise<ExecutionResult>;
export type CapabilityVerifyHandler = (context: CapabilityContext, execution: ExecutionResult) => Promise<VerificationResult>;

export type OyiCapabilityDefinition = {
  key: string;
  domain: OyiDomain;
  operations: string[];
  supported_surfaces: OyiSurface[];
  scope_requirements: ScopeRequirement[];
  permission_requirements: string[];
  risk_class: CapabilityRiskClass;
  confirmation_policy: ConfirmationPolicy;
  evidence_requirements: EvidenceRequirement[];
  resolver: CapabilityResolver;
  read_handler?: CapabilityReadHandler;
  draft_handler?: CapabilityDraftHandler;
  execute_handler?: CapabilityExecuteHandler;
  verify_handler?: CapabilityVerifyHandler;
  workflow_definition?: WorkflowDefinition;
  presentation_policy: CapabilityPresentationPolicy;
  rollout_status: CapabilityRolloutStatus;
};

export interface CapabilityModule {
  key: string;
  domain: OyiDomain;
  rolloutStatus: CapabilityRolloutStatus;
  operations?: string[];
  supported_surfaces?: OyiSurface[];
  scope_requirements?: ScopeRequirement[];
  permission_requirements?: string[];
  risk_class?: CapabilityRiskClass;
  confirmation_policy?: ConfirmationPolicy;
  evidence_requirements?: EvidenceRequirement[];
  workflow_definition?: WorkflowDefinition;
  presentation_policy?: CapabilityPresentationPolicy;
  supports(frame: SemanticFrame): boolean;
  resolve(context: CapabilityContext): Promise<CapabilityResolution>;
  collectEvidence(context: CapabilityContext): Promise<OyiEvidence[]>;
  buildReadResponse?(context: CapabilityContext, evidence: OyiEvidence[]): Promise<DomainResult | ConversationRunResult>;
  createDraft?(context: CapabilityContext): Promise<DomainResult | ConversationRunResult>;
  authorize?(context: CapabilityContext): Promise<AuthorityDecision>;
  execute?(context: CapabilityContext, action: OyiAction): Promise<ExecutionResult>;
  verify?(context: CapabilityContext, execution: ExecutionResult): Promise<VerificationResult>;
}
