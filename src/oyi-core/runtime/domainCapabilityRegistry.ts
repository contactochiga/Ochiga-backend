import type { NormalizedUserTurn, OyiDomain, OyiOperation } from "./languageUnderstanding";

export type AuthorityTier = 0 | 1 | 2 | 3 | 4;

export type AuthorityDecision = {
  allowed: boolean;
  tier: AuthorityTier;
  approval_required: boolean;
  secure_review_required: boolean;
  required_permissions: string[];
  denial_reason: string | null;
};

export type SemanticDestination = {
  key: string;
  operation: "navigate" | "handoff";
};

export type DomainCapability = {
  domain: OyiDomain;
  supported_operations: OyiOperation[];
  inline_reads: string[];
  details: string[];
  drafts: string[];
  mutations: string[];
  requires_clarification: string[];
  requires_approval: string[];
  secure_handoff: string[];
  unsupported: string[];
  authority_tier: AuthorityTier;
  presentation_primary: "text" | "list" | "table" | "detail" | "clarification" | "review" | "approval" | "execution" | "navigation";
  semantic_destinations: SemanticDestination[];
};

const READ_OPS: OyiOperation[] = ["inform", "summarize", "list", "inspect", "navigate"];

export const DOMAIN_CAPABILITIES: DomainCapability[] = [
  { domain: "home", supported_operations: READ_OPS, inline_reads: ["summary", "recent_changes", "attention"], details: [], drafts: [], mutations: [], requires_clarification: [], requires_approval: [], secure_handoff: [], unsupported: ["execute"], authority_tier: 0, presentation_primary: "list", semantic_destinations: [{ key: "home.module", operation: "navigate" }] },
  { domain: "rooms", supported_operations: READ_OPS.concat(["clarify"]), inline_reads: ["summary", "inventory", "recent_changes", "maintenance", "environment"], details: ["room_detail"], drafts: [], mutations: ["broad_room_control"], requires_clarification: ["ambiguous_room"], requires_approval: ["broad_room_control"], secure_handoff: [], unsupported: [], authority_tier: 0, presentation_primary: "table", semantic_destinations: [{ key: "rooms.detail", operation: "navigate" }] },
  { domain: "devices", supported_operations: READ_OPS.concat(["propose_mutation", "approve", "reject", "cancel"]), inline_reads: ["status", "activity", "failures", "diagnosis", "relationships", "capabilities", "availability"], details: ["device_detail", "channel_detail"], drafts: ["configuration_change"], mutations: ["power", "channels", "dimmer", "temperature", "mode", "ir_command"], requires_clarification: ["ambiguous_device", "ambiguous_channel"], requires_approval: ["device_control", "configuration_change"], secure_handoff: ["lock_sensitive"], unsupported: [], authority_tier: 1, presentation_primary: "approval", semantic_destinations: [{ key: "devices.module", operation: "navigate" }, { key: "devices.detail", operation: "navigate" }] },
  { domain: "visitors", supported_operations: READ_OPS.concat(["compose", "approve", "reject", "cancel"]), inline_reads: ["pending", "active", "today", "detail", "expired"], details: ["visitor_detail"], drafts: ["create_visitor", "generate_pass"], mutations: ["approve", "reject", "extend", "revoke"], requires_clarification: ["missing_visitor_inputs"], requires_approval: ["create_visitor", "revoke", "approve"], secure_handoff: ["access_code_display"], unsupported: [], authority_tier: 3, presentation_primary: "review", semantic_destinations: [{ key: "visitors.module", operation: "navigate" }, { key: "visitors.detail", operation: "navigate" }] },
  { domain: "access", supported_operations: READ_OPS.concat(["approve", "reject", "cancel"]), inline_reads: ["access_status", "entry_history"], details: ["access_pass"], drafts: [], mutations: ["approve_access", "revoke_access", "unlock"], requires_clarification: ["missing_access_target"], requires_approval: ["approve_access", "revoke_access"], secure_handoff: ["unlock", "credential_export"], unsupported: [], authority_tier: 3, presentation_primary: "approval", semantic_destinations: [{ key: "visitors.module", operation: "navigate" }] },
  { domain: "security", supported_operations: READ_OPS.concat(["compose", "approve", "reject", "cancel"]), inline_reads: ["alerts", "incidents", "posture", "access_anomalies", "door_status"], details: ["incident_detail", "access_point_detail"], drafts: ["acknowledge_incident", "escalate_incident"], mutations: ["acknowledge", "escalate", "alarm_control"], requires_clarification: ["which_incident", "which_access_point"], requires_approval: ["acknowledge", "escalate", "alarm_control"], secure_handoff: ["camera_live_view", "credential_export"], unsupported: ["raw_camera_stream", "credential_display"], authority_tier: 3, presentation_primary: "detail", semantic_destinations: [{ key: "security.module", operation: "navigate" }, { key: "incident.detail", operation: "navigate" }] },
  { domain: "maintenance", supported_operations: READ_OPS.concat(["compose", "approve", "reject", "cancel"]), inline_reads: ["open", "overdue", "status", "latest_update"], details: ["request_detail"], drafts: ["create_request", "add_note"], mutations: ["submit_request", "cancel_request", "reopen_request"], requires_clarification: ["missing_maintenance_inputs"], requires_approval: ["submit_request", "cancel_request"], secure_handoff: [], unsupported: ["facility_assign"], authority_tier: 2, presentation_primary: "review", semantic_destinations: [{ key: "maintenance.module", operation: "navigate" }, { key: "maintenance.detail", operation: "navigate" }] },
  { domain: "wallet", supported_operations: READ_OPS.concat(["compose", "approve", "reject", "cancel"]), inline_reads: ["balance", "history", "recent_transactions", "funding_total"], details: ["transaction_detail", "receipt"], drafts: ["fund_wallet"], mutations: ["fund_wallet"], requires_clarification: ["missing_amount"], requires_approval: ["fund_wallet"], secure_handoff: ["high_value_transfer"], unsupported: [], authority_tier: 3, presentation_primary: "table", semantic_destinations: [{ key: "wallet.summary", operation: "navigate" }] },
  { domain: "transactions", supported_operations: READ_OPS, inline_reads: ["history", "detail", "failed_explanation", "receipt_lookup", "monthly_spending"], details: ["transaction_detail"], drafts: [], mutations: [], requires_clarification: [], requires_approval: [], secure_handoff: [], unsupported: ["execute"], authority_tier: 0, presentation_primary: "table", semantic_destinations: [{ key: "wallet.transaction", operation: "navigate" }] },
  { domain: "utilities", supported_operations: READ_OPS.concat(["compose", "approve", "reject", "cancel"]), inline_reads: ["active_services", "status", "balance", "usage", "meter_status", "tariff", "payment_history", "outage"], details: ["utility_detail"], drafts: ["buy_electricity", "pay_water", "renew_internet", "report_outage"], mutations: ["buy_electricity", "pay_utility"], requires_clarification: ["which_utility"], requires_approval: ["buy_electricity", "pay_utility"], secure_handoff: ["payment"], unsupported: [], authority_tier: 3, presentation_primary: "table", semantic_destinations: [{ key: "utilities.module", operation: "navigate" }] },
  { domain: "services", supported_operations: READ_OPS.concat(["compose"]), inline_reads: ["active_services", "service_status"], details: ["service_detail"], drafts: ["service_request"], mutations: [], requires_clarification: ["which_service"], requires_approval: [], secure_handoff: [], unsupported: [], authority_tier: 0, presentation_primary: "list", semantic_destinations: [{ key: "services.module", operation: "navigate" }] },
  { domain: "community", supported_operations: READ_OPS.concat(["compose", "approve", "reject", "cancel"]), inline_reads: ["latest_posts", "management_notices", "unread_count", "post_summary"], details: ["post_detail"], drafts: ["draft_post", "draft_comment"], mutations: ["publish_post", "publish_comment"], requires_clarification: ["missing_post_inputs"], requires_approval: ["publish_post", "publish_comment"], secure_handoff: [], unsupported: [], authority_tier: 2, presentation_primary: "list", semantic_destinations: [{ key: "community.module", operation: "navigate" }] },
  { domain: "messages", supported_operations: READ_OPS.concat(["compose", "approve", "reject", "cancel"]), inline_reads: ["unread", "recent", "thread_summary"], details: ["message_thread"], drafts: ["draft_reply"], mutations: ["send_reply"], requires_clarification: ["which_thread"], requires_approval: ["send_reply"], secure_handoff: [], unsupported: [], authority_tier: 2, presentation_primary: "review", semantic_destinations: [{ key: "messages.module", operation: "navigate" }] },
  { domain: "scenes", supported_operations: READ_OPS.concat(["compose", "approve", "reject", "cancel"]), inline_reads: ["show_scenes", "recent_runs"], details: ["scene_detail"], drafts: ["draft_scene"], mutations: ["save_scene", "run_scene"], requires_clarification: ["missing_scene_inputs"], requires_approval: ["save_scene", "run_scene"], secure_handoff: [], unsupported: [], authority_tier: 2, presentation_primary: "review", semantic_destinations: [{ key: "scenes.module", operation: "navigate" }] },
  { domain: "automations", supported_operations: READ_OPS.concat(["compose", "approve", "reject", "cancel"]), inline_reads: ["show_automations", "recent_runs", "failure_explanation"], details: ["automation_detail"], drafts: ["draft_automation"], mutations: ["save_automation", "pause", "resume"], requires_clarification: ["missing_automation_inputs"], requires_approval: ["save_automation", "pause", "resume"], secure_handoff: [], unsupported: [], authority_tier: 2, presentation_primary: "review", semantic_destinations: [{ key: "automations.module", operation: "navigate" }] },
  { domain: "reports", supported_operations: ["summarize", "list", "inspect"], inline_reads: ["operational_report", "period_summary", "comparison", "trend"], details: ["report_detail"], drafts: [], mutations: [], requires_clarification: ["missing_report_scope"], requires_approval: [], secure_handoff: [], unsupported: ["execute", "export_without_report_workflow"], authority_tier: 0, presentation_primary: "detail", semantic_destinations: [] },
  { domain: "cameras", supported_operations: READ_OPS, inline_reads: ["status", "offline", "recent_motion", "event_detail"], details: ["camera_detail"], drafts: [], mutations: [], requires_clarification: ["which_camera"], requires_approval: [], secure_handoff: ["live_view", "clip"], unsupported: ["unrestricted_stream"], authority_tier: 0, presentation_primary: "navigation", semantic_destinations: [{ key: "cameras.module", operation: "handoff" }] },
  { domain: "notifications", supported_operations: READ_OPS, inline_reads: ["unread", "recent", "detail"], details: ["notification_detail"], drafts: [], mutations: [], requires_clarification: [], requires_approval: [], secure_handoff: [], unsupported: ["push_mutation"], authority_tier: 0, presentation_primary: "list", semantic_destinations: [{ key: "notifications.module", operation: "navigate" }] },
  { domain: "incidents", supported_operations: READ_OPS, inline_reads: ["active", "recent", "detail", "evidence"], details: ["incident_detail"], drafts: [], mutations: [], requires_clarification: ["which_incident"], requires_approval: [], secure_handoff: [], unsupported: ["resolve_facility_incident"], authority_tier: 0, presentation_primary: "detail", semantic_destinations: [{ key: "incidents.detail", operation: "navigate" }] },
  { domain: "global", supported_operations: ["inform", "summarize", "list", "inspect", "navigate"], inline_reads: ["capabilities", "help"], details: [], drafts: [], mutations: [], requires_clarification: [], requires_approval: [], secure_handoff: [], unsupported: ["execute"], authority_tier: 0, presentation_primary: "text", semantic_destinations: [] },
];

export function getDomainCapability(domain: OyiDomain | null | undefined) {
  return DOMAIN_CAPABILITIES.find((capability) => capability.domain === domain) || null;
}

export function capabilityKeyForTurn(turn: NormalizedUserTurn) {
  const domain = turn.domain || "global";
  if (turn.operation === "navigate") return `${domain}.navigate`;
  if (turn.operation === "compose") return `${domain}.draft`;
  if (["propose_mutation", "approve", "execute"].includes(turn.operation)) return `${domain}.action`;
  if (turn.operation === "list") return `${domain}.list`;
  if (turn.operation === "summarize") return `${domain}.summary`;
  if (turn.operation === "inspect") return `${domain}.detail`;
  return `${domain}.inform`;
}

export function decideAuthorityForTurn(turn: NormalizedUserTurn): AuthorityDecision {
  const capability = getDomainCapability(turn.domain || "global");
  const tier = capability?.authority_tier ?? 0;
  const mutation = turn.mutation_intent;
  return {
    allowed: true,
    tier,
    approval_required: mutation && tier >= 1,
    secure_review_required: mutation && tier >= 3,
    required_permissions: [],
    denial_reason: null,
  };
}
