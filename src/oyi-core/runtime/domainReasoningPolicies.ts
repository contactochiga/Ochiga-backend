export type ReasoningPolicy = {
  domain: string;
  evidenceTypes: string[];
  excludedEvidence: string[];
  timeWindowMinutes: number;
  confidenceRule: string;
  verificationRule: string;
  recoveryRule: string;
  severityRule: string;
  ownerRule: string;
  nextActionRule: string;
};

export const DOMAIN_REASONING_POLICIES: ReasoningPolicy[] = [
  {
    domain: "device_availability",
    evidenceTypes: ["provider_online", "last_successful_read", "last_seen", "gateway_state", "failure_count"],
    excludedEvidence: ["provider_ack_only", "expired_cache_only"],
    timeWindowMinutes: 30,
    confidenceRule: "Provider offline plus failed reads increases confidence; expired state alone remains unknown.",
    verificationRule: "Require provider state, local gateway state, or successful canonical refresh.",
    recoveryRule: "Successful current provider read resolves stale/offline incident.",
    severityRule: "Security devices and critical infrastructure rank higher than routine plugs.",
    ownerRule: "Resident-owned devices remain home-private; building-managed devices route to Facility.",
    nextActionRule: "Reconnect provider, check gateway, or inspect hardware depending on binding state.",
  },
  {
    domain: "device_command_lifecycle",
    evidenceTypes: ["command_requested", "provider_acknowledged", "state_confirmed", "command_failed"],
    excludedEvidence: ["audit.recorded"],
    timeWindowMinutes: 15,
    confidenceRule: "Requested, accepted and executed are lifecycle siblings, not independent corroboration.",
    verificationRule: "Provider acknowledgement is not physical confirmation unless a readable state confirms it.",
    recoveryRule: "Confirmed target state or explicit failure closes the command lifecycle.",
    severityRule: "Failed high-risk commands rank above routine low-risk switches.",
    ownerRule: "Use canonical command actor and ownership scope.",
    nextActionRule: "Show truthful pending, confirmed, failed or timed-out state.",
  },
  {
    domain: "infrastructure",
    evidenceTypes: ["device_outage", "provider_outage", "gateway_outage", "utility_telemetry"],
    excludedEvidence: ["resident_private_routine_command"],
    timeWindowMinutes: 60,
    confidenceRule: "Multiple affected entities or parent gateway evidence increases confidence.",
    verificationRule: "Require infrastructure source or multiple child impacts before broad outage claims.",
    recoveryRule: "Parent recovery resolves child awareness where still represented by the parent.",
    severityRule: "Blast radius and shared-service impact determine severity.",
    ownerRule: "Building-managed assets route to Facility operations.",
    nextActionRule: "Inspect parent infrastructure first, then child devices.",
  },
  {
    domain: "security/access",
    evidenceTypes: ["access_denied", "tamper", "wrong_attempt", "camera_event", "visitor_lifecycle"],
    excludedEvidence: ["routine_lock_state", "private_credential_payload"],
    timeWindowMinutes: 30,
    confidenceRule: "Security confidence requires event source and role-authorized evidence.",
    verificationRule: "Review access record, camera evidence where authorized, and actor scope.",
    recoveryRule: "Acknowledgement or resolved incident closes monitoring.",
    severityRule: "Tamper and repeated failed attempts are critical; routine state is informational.",
    ownerRule: "Smart Access private stays home-private unless policy escalation allows Facility.",
    nextActionRule: "Notify authorized resident/security audience only.",
  },
  {
    domain: "maintenance",
    evidenceTypes: ["ticket_status", "sla", "asset_history", "resident_message"],
    excludedEvidence: ["unrelated_audit"],
    timeWindowMinutes: 1440,
    confidenceRule: "SLA and repeated asset issues increase confidence.",
    verificationRule: "Check ticket lifecycle, owner, assignment, and recent messages.",
    recoveryRule: "Completion plus verification resolves recommendation.",
    severityRule: "Safety and SLA breach increase severity.",
    ownerRule: "Assigned maintenance owner or Facility manager.",
    nextActionRule: "Assign owner, update SLA, or request verification.",
  },
  {
    domain: "visitors",
    evidenceTypes: ["visitor_status", "access_window", "approval", "entry_exit"],
    excludedEvidence: ["private_home_context_unrelated"],
    timeWindowMinutes: 720,
    confidenceRule: "Access state derives from pass validity and status, not name matches.",
    verificationRule: "Check pass window and current access policy.",
    recoveryRule: "Expired/revoked/entered/exited final states close transient awareness.",
    severityRule: "Denied or suspicious access outranks routine arrival.",
    ownerRule: "Resident for private visitor, security for building queue.",
    nextActionRule: "Approve, deny, verify, or explain validity.",
  },
  {
    domain: "wallet/financial",
    evidenceTypes: ["transaction", "receipt", "provider_confirmation", "balance"],
    excludedEvidence: ["unapproved_financial_mutation"],
    timeWindowMinutes: 1440,
    confidenceRule: "Provider confirmation and ledger entries determine fact level.",
    verificationRule: "Use receipts and payment provider state.",
    recoveryRule: "Reconciled provider status resolves pending/failed ambiguity.",
    severityRule: "Failed funding and service-risk balances rank higher.",
    ownerRule: "Financial authorization and home/account scope.",
    nextActionRule: "Explain, reconcile, or route to payment workflow with approval.",
  },
  {
    domain: "services",
    evidenceTypes: ["subscription", "provisioning", "billing", "support_status"],
    excludedEvidence: ["template_claim"],
    timeWindowMinutes: 1440,
    confidenceRule: "Service state needs account or provisioning evidence.",
    verificationRule: "Check service account and billing continuity.",
    recoveryRule: "Provisioned or renewed status resolves service interruption.",
    severityRule: "Continuity-impacting service loss outranks informational status.",
    ownerRule: "Service owner or Facility operations by scope.",
    nextActionRule: "Open support path or explain continuity state.",
  },
  {
    domain: "community",
    evidenceTypes: ["announcement", "moderation", "request", "complaint"],
    excludedEvidence: ["private_conversation_content"],
    timeWindowMinutes: 1440,
    confidenceRule: "Use visible post/request status and moderation state.",
    verificationRule: "Check author visibility and official status.",
    recoveryRule: "Resolved moderation/request closes awareness.",
    severityRule: "Urgent official notices outrank routine posts.",
    ownerRule: "Community moderator or author by policy.",
    nextActionRule: "Summarize, moderate, or route to support.",
  },
  {
    domain: "environment",
    evidenceTypes: ["sensor_reading", "climate_state", "occupancy_context"],
    excludedEvidence: ["stale_sensor_only"],
    timeWindowMinutes: 120,
    confidenceRule: "Fresh sensor state and corroboration determine confidence.",
    verificationRule: "Check freshness and device availability.",
    recoveryRule: "Normal fresh reading resolves exposure.",
    severityRule: "Safety and comfort thresholds determine severity.",
    ownerRule: "Home owner or Facility for shared environment.",
    nextActionRule: "Inspect sensor, adjust climate workflow, or explain uncertainty.",
  },
  {
    domain: "scene_failures",
    evidenceTypes: ["scene_run", "action_result", "command_execution"],
    excludedEvidence: ["provider_ack_only_as_physical_confirmation"],
    timeWindowMinutes: 60,
    confidenceRule: "Per-action result determines failure, not parent request alone.",
    verificationRule: "Check scene action ledger and command lifecycle.",
    recoveryRule: "Successful rerun or corrected action resolves.",
    severityRule: "Number and risk class of failed actions determines severity.",
    ownerRule: "Scene owner/home scope.",
    nextActionRule: "Explain failed action and suggest safe correction.",
  },
  {
    domain: "automation_failures",
    evidenceTypes: ["automation_run", "trigger_occurrence", "action_result", "schedule"],
    excludedEvidence: ["enabled_flag_without_scheduler_run"],
    timeWindowMinutes: 1440,
    confidenceRule: "Run ledger and trigger occurrence key are authoritative.",
    verificationRule: "Check timezone, next_run_at, run status, and action outcomes.",
    recoveryRule: "Next successful occurrence or corrected schedule resolves.",
    severityRule: "Missed critical schedule outranks manual test failure.",
    ownerRule: "Automation creator/home scope.",
    nextActionRule: "Explain skipped/failed reason and safe edit path.",
  },
];

export function reasoningPolicyFor(domain: string) {
  const needle = domain.toLowerCase();
  return DOMAIN_REASONING_POLICIES.find((policy) => policy.domain === needle || policy.domain.includes(needle) || needle.includes(policy.domain)) || DOMAIN_REASONING_POLICIES[0];
}
