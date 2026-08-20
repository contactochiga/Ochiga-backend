import type { OisContext, OyiTarget } from "../../types/oisContext";
import type { OyiSurface } from "../../services/oyiUnifiedIntelligenceService";
import type { AuthorityDecision } from "../runtime/domainCapabilityRegistry";
import type { CanonicalTarget } from "../runtime/conversationWorkflowRuntime";
import type {
  IntelligenceRequestContract,
  ScopeMode,
} from "../interpretation/conversationIntentRouting";

export type OperationalObjectType =
  | "estate"
  | "building"
  | "tower"
  | "block"
  | "floor"
  | "wing"
  | "home"
  | "room"
  | "corridor"
  | "zone"
  | "device"
  | "device_channel"
  | "visitor"
  | "access_pass"
  | "visitor_access"
  | "maintenance_request"
  | "wallet"
  | "transaction"
  | "service_account"
  | "infrastructure_asset"
  | "access_point"
  | "emergency_asset"
  | "provider"
  | "camera"
  | "meter"
  | "scene"
  | "automation"
  | "automation_run"
  | "message_thread"
  | "community_post"
  | "notification"
  | "operational_incident"
  | "operational_event"
  | "twin_node"
  | "security_incident"
  | "utility_tariff"
  | "utility_purchase";

export type TruthState =
  | "confirmed"
  | "observed"
  | "inferred"
  | "predicted"
  | "pending_confirmation"
  | "unavailable"
  | "unsupported"
  | "permission_restricted";

export type OperationalObject = {
  object_type: OperationalObjectType;
  canonical_id: string;
  label: string;
  estate_id: string | null;
  building_id: string | null;
  home_id: string | null;
  room_id: string | null;
  parent_id: string | null;
  source_module: string | null;
  capabilities: string[];
  current_state: string | null;
  health: string | null;
  permissions: string[];
  relationships: Record<string, unknown>;
  evidence_references: string[];
  metadata: Record<string, unknown>;
  freshness: string | null;
};

export type CanonicalTruth = {
  title: string;
  body: string;
  truth_state: TruthState;
  severity: "normal" | "info" | "attention" | "warning" | "critical";
  source_event: string | null;
  confidence: number | null;
  object: OperationalObject | null;
  occurred_at: string | null;
  freshness: string | null;
  recommended_actions: Array<Record<string, unknown>>;
  active_execution: Record<string, unknown> | null;
  target: OyiTarget | null;
  technical_details: Record<string, unknown> | null;
};

export type ConversationOperation =
  | "inform"
  | "inspect"
  | "list"
  | "navigate_module"
  | "navigate_object"
  | "compose"
  | "control"
  | "approve"
  | "reject"
  | "cancel"
  | "handoff"
  | "clarify";

export type ConversationPresentationPolicy = {
  intent: string;
  operation: string;
  primary: "sentence" | "text" | "status" | "table" | "summary_card" | "object_card" | "clarification" | "review" | "approval" | "navigation_transition" | "handoff" | "error";
  allowed_supporting_blocks: string[];
  allowed_action_types: string[];
  suppress_awareness: boolean;
  suppress_equivalent_awareness: boolean;
  suppress_context_chips: boolean;
  suppress_duplicate_status: boolean;
  evidence_visibility: "hidden" | "collapsed" | "visible";
  snapshot_mode: "none" | "historical" | "current_state_snapshot";
  auto_navigation: boolean;
};

export type ResolvedConversationTurn = {
  rawMessage: string;
  intent: string;
  operation: ConversationOperation;
  scope: "exact_object" | "room" | "home" | "building" | "module" | "thread_reference" | "ambiguous";
  domain: string | null;
  object: {
    type: string;
    id: string;
    label: string | null;
    parent_id?: string | null;
    room_id?: string | null;
    channel_code?: string | null;
  } | null;
  destination: { key: string; parameters: Record<string, string> } | null;
  ambiguity: {
    required: boolean;
    question: string | null;
    candidates: Array<{ type: string; id: string; label: string; detail?: string | null }>;
  };
  authority: {
    allowed: boolean;
    required_permission: string | null;
    confirmation_required: boolean;
    secure_review_required: boolean;
    denial_reason: string | null;
  };
  presentation: { mode: ConversationPresentationPolicy["primary"] };
  temporal_scope: IntelligenceRequestContract["temporal_scope"];
  confidence: number;
};

export type ResolvedOyiTurn = {
  request_id: string;
  thread_id: string;
  operation: string;
  domain: string | null;
  capability_key: string;
  scope: {
    estate_id: string | null;
    building_id: string | null;
    home_id: string | null;
    room_id: string | null;
  };
  target: CanonicalTarget | null;
  target_source:
    | "current_turn"
    | "active_workflow"
    | "valid_reference"
    | "page_context"
    | "thread_memory"
    | "authorised_fallback";
  temporal_scope: IntelligenceRequestContract["temporal_scope"] | null;
  authority: AuthorityDecision;
  workflow_id: string | null;
  presentation_policy: ConversationPresentationPolicy;
};

export type CanonicalConversationRequest = {
  message: string;
  surface: OyiSurface;
  estate_id?: string | null;
  home_id?: string | null;
  module?: string | null;
  role?: string | null;
  thread_id?: string | null;
  context?: OisContext | Record<string, unknown> | null;
  operational_object?: Partial<OperationalObject> | null;
  target?: OyiTarget | null;
  device_id?: string | null;
  device_name?: string | null;
  room_id?: string | null;
  room_name?: string | null;
  control_profile?: string | null;
  primary_state?: string | null;
  health_status?: string | null;
  supported_controls?: string[] | null;
  channel_definitions?: Array<Record<string, unknown>> | null;
  memory_summary?: Record<string, unknown> | null;
  relationships?: Record<string, unknown> | null;
  predictive_findings?: Array<Record<string, unknown>> | null;
  recent_executions?: Array<Record<string, unknown>> | null;
  active_scenes?: Array<Record<string, unknown>> | null;
  active_automations?: Array<Record<string, unknown>> | null;
  active_intelligence_context?: Record<string, unknown> | null;
  conversation_context?: Record<string, unknown> | null;
  workflow_id?: string | null;
  intent_hint?: string | null;
  operation_class_hint?: string | null;
  scope_mode_hint?: string | null;
};

export type CanonicalConversationResponse = {
  id: string;
  thread_id: string | null;
  intent: string;
  understood: string | null;
  summary: string;
  answer: string;
  reply: string;
  message: string;
  display_mode: "conversation" | "awareness" | "list" | "detail" | "audit" | "report";
  truth: CanonicalTruth;
  operational_object: OperationalObject | null;
  context: {
    surface: OyiSurface;
    estate_id: string | null;
    home_id: string | null;
    module: string | null;
    context_source: "explicit_request" | "thread_state" | "page_selection" | "home_scope" | "estate_scope" | "global_scope";
    warnings: string[];
    target_resolution?: Record<string, unknown>;
    module_facts?: Record<string, unknown>;
    request_contract?: IntelligenceRequestContract;
  };
  resolved_turn?: ResolvedConversationTurn;
  execution: Record<string, unknown>;
  cards: Array<Record<string, unknown>>;
  sources: Array<Record<string, unknown>>;
  suggested_actions: Array<Record<string, unknown>>;
  awareness?: Record<string, unknown>;
  presentation_policy?: ConversationPresentationPolicy;
  confirmations: Array<Record<string, unknown>>;
  warnings: string[];
  persistence_saved?: boolean;
  source: "oyi_canonical_runtime";
  safe_mode: true;
  approvalRequired: boolean;
  requiresConfirmation: boolean;
  // Full evidence facts backing this turn's answer, and the capability that
  // produced them — carried through to persistence only, never returned to
  // the client (see routes that JSON-serialize a subset). Used generically
  // by persistCanonicalConversationTurn to derive/store a result-set
  // context for the next turn's follow-up resolution.
  facts?: IntelligenceFact[];
  capability_key?: string | null;
  // Loosely typed here to avoid an import cycle with resultSetContext.ts;
  // persistence/orchestrator code casts to the concrete ResultSetContext.
  result_set?: Record<string, unknown> | Record<string, unknown>[] | null;
  // Oyi Conversational Runtime Completion Programme, Phase 3. Three-state
  // by design (matches business_active_context in officeConversationContext.
  // ts): the KEY absent entirely means "nothing changed this turn, preserve
  // whatever's already persisted" (an unrelated read question shouldn't
  // wipe a pending mutation proposal); present with null means "explicitly
  // clear" (cancelled / verified / superseded); present with a value means
  // "set/update". See CapabilityResponseAdapter.ts for how this is
  // populated only when a capability's DomainResult.metadata explicitly
  // sets the key, and canonicalConversationPersistence.ts for how the
  // three states are interpreted on write.
  pending_action_proposal?: Record<string, unknown> | null;
};

export type ConversationBuilderKey =
  | "device_status"
  | "device_activity"
  | "device_failures"
  | "device_diagnosis"
  | "device_relationships"
  | "device_control"
  | "home_summary"
  | "offline_inventory"
  | "recent_changes"
  | "wallet_history"
  | "wallet_summary"
  | "utility_spending"
  | "domain_list"
  | "module_navigation"
  | "object_navigation"
  | "clarification"
  | "general_help";

export type CurrentTurnAuthorityDecision = {
  operation: string;
  domain: string | null;
  scope: ScopeMode;
  explicitRoomPhrase: string | null;
  explicitObjectPhrase: string | null;
  temporalScope: string | null;
  mayUseInheritedExactTarget: boolean;
  rejectionReason: string | null;
};

export type PendingClarification = {
  clarification_id: string;
  thread_id: string;
  original_user_message: string;
  operation: string;
  domain: string;
  requested_action: string | null;
  requested_state: string | null;
  requested_phrase: string | null;
  candidate_ids: string[];
  candidates: Array<Record<string, unknown>>;
  selected_candidate_id: string | null;
  unresolved_fields: string[];
  created_at: string;
  expires_at: string | null;
};

export type IntelligenceFact = {
  fact_id: string;
  domain: string;
  fact_type: string;
  scope: Record<string, string | null>;
  object: {
    object_type: string;
    canonical_id: string;
    label: string;
  } | null;
  statement: string;
  value: unknown;
  previous_value: unknown;
  occurred_at: string | null;
  observed_at: string;
  source_type: "live_state" | "database" | "execution_ledger" | "audit" | "event" | "calculation" | "prediction";
  source_id: string | null;
  truth_state: TruthState;
  confidence: number | null;
  freshness: string;
  privacy_class: string;
  permissions: string[];
  evidence: Array<Record<string, unknown>>;
};
