import type {
  IntelligenceFact,
} from "../contracts/canonicalConversation";
import type { IntelligenceRequestContract } from "../interpretation/conversationIntentRouting";
import { utilitySpendingRows } from "../domains/utilities/utilityConversationAnswers";
import { safeDateLabel } from "./timeFreshness";

export type ConversationTableBlock = {
  type: "table";
  title?: string | null;
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, string | number | null>>;
  compact?: boolean;
  snapshot?: Record<string, string | null>;
};

// Oyi Conversational Runtime Completion Programme, Phase 4 -- adaptive
// response blocks. Siblings of ConversationTableBlock, same convention
// (a discriminated "type" field, plain-data shape, no HTML). Backend
// returns semantic presentation intent; the frontend (Office's
// renderResponseBlocks(), Consumer's existing block renderer) decides
// how to draw it. DomainResult.blocks stays loosely typed
// (Array<Record<string, unknown>>) -- these types are a convention
// capabilities follow, not a runtime-enforced union, matching how
// ConversationTableBlock itself already works.
export type ConversationKeyValueBlock = {
  type: "key_value";
  title?: string | null;
  items: Array<{ label: string; value: string }>;
};

export type ConversationStatusBlock = {
  type: "status";
  label: string;
  tone?: "neutral" | "positive" | "warning" | "critical" | null;
};

// A record-list is a table with an identity: each row carries a hidden
// id (never rendered as a visible column) so a later turn's ordinal/
// pronoun reference ("the first two") can resolve back to a specific
// record without the user repeating names or IDs. total_count/truncated
// let the frontend show "32 open leads, showing 10" honestly rather than
// implying the table is the complete set when it isn't.
export type ConversationRecordListBlock = {
  type: "record_list";
  title?: string | null;
  columns: Array<{ key: string; label: string }>;
  rows: Array<{ id: string; status?: string | null } & Record<string, string | number | null>>;
  total_count?: number | null;
  truncated?: boolean;
};

// warning: something the user should know but that isn't blocking.
// limitation: an honest "I can't do that yet" boundary -- distinct tone
// from a warning, never phrased as if it were an error on the user's part.
export type ConversationNoteBlock = {
  type: "warning" | "limitation";
  text: string;
};

export type ConversationBlock =
  | ConversationTableBlock
  | ConversationKeyValueBlock
  | ConversationStatusBlock
  | ConversationRecordListBlock
  | ConversationNoteBlock;

export type PresentationFactPredicates = {
  factAppliesToContract: (fact: IntelligenceFact, contract: IntelligenceRequestContract) => boolean;
  isResidentVisibleOperationalFact: (fact: IntelligenceFact) => boolean;
  isUsefulDeviceActivityFact: (fact: IntelligenceFact) => boolean;
  securityRiskAllowed: (claim: string, facts: IntelligenceFact[], threshold: number) => boolean;
};

function text(value: unknown) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanLabel(value: unknown, fallback: string) {
  const raw = text(value);
  return raw || fallback;
}

function isUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(value));
}

function residentSafeLabel(value: unknown, fallback: string) {
  const label = text(value);
  if (!label || isUuid(label) || /^[0-9a-f-]{18,}$/i.test(label)) return fallback;
  return label;
}

function humanCommandDirection(value: unknown) {
  const command = recordOf(value);
  for (const [key, raw] of Object.entries(command)) {
    if (/^switch_\d+$/i.test(key) || ["switch", "power", "on"].includes(key)) {
      if (typeof raw === "boolean") return raw ? "On" : "Off";
    }
  }
  return "";
}

function recentChangeRows(facts: IntelligenceFact[], contract: IntelligenceRequestContract, predicates: PresentationFactPredicates) {
  return facts.filter((fact) => {
    if (contract.scope_mode === "room_scope" && contract.target.canonical_id && fact.scope.room_id !== contract.target.canonical_id) return false;
    return predicates.factAppliesToContract(fact, contract)
      && predicates.isResidentVisibleOperationalFact(fact)
      && predicates.isUsefulDeviceActivityFact(fact);
  });
}

function groupRecentChangeRows(facts: IntelligenceFact[]) {
  const grouped = new Map<string, Record<string, string | number | null>>();
  for (const fact of facts) {
    const value = recordOf(fact.value);
    const command = recordOf(value.command || value.expected_state || value.normalized_command);
    const action = humanCommandDirection(command) || cleanLabel(text(value.action || value.status || fact.fact_type).replace(/_/g, " "), "Updated");
    const result = /not_observable|unknown/.test(text(value.physical_effect_status).toLowerCase())
      ? "Accepted; physical response not observable"
      : /confirmed|state_confirmed|executed/.test(text(value.status).toLowerCase())
        ? "Confirmed"
        : /failed|rejected|timeout|mismatch/.test(text(value.status).toLowerCase())
          ? "Failed"
          : cleanLabel(text(value.status).replace(/_/g, " "), "Recorded");
    const channel = text(value.channel_code).replace(/^switch_/i, "Channel ") || null;
    const device = residentSafeLabel(cleanLabel(fact.object?.label, "Device").replace(/\s+switch_\d+$/i, "").replace(/\s+Channel\s+\d+$/i, ""), "Device");
    const room = residentSafeLabel(recordOf(fact.value).room_name || fact.scope.room_id, "");
    const latest = fact.occurred_at || fact.observed_at;
    const key = [fact.object?.canonical_id || "scope", action, result, channel || ""].join(":").toLowerCase();
    const existing = grouped.get(key);
    if (existing) {
      existing.count = Number(existing.count || 1) + 1;
      if (Date.parse(latest) > Date.parse(String(existing.occurred_at || ""))) existing.occurred_at = latest;
      continue;
    }
    grouped.set(key, {
      event_id: fact.source_id || fact.fact_id,
      target_type: fact.object?.object_type || "home",
      target_id: fact.object?.canonical_id || "",
      device_name: device,
      room_name: room || null,
      channel_label: channel,
      action,
      result,
      occurred_at: safeDateLabel(latest, "Time unavailable", "relative"),
      sort_at: latest || null,
      truth_state: fact.truth_state,
      device_family: text(recordOf(fact.value).device_family || recordOf(fact.value).category) || "device",
      count: 1,
    });
  }
  return Array.from(grouped.values()).sort((a, b) => Date.parse(String(b.sort_at || "")) - Date.parse(String(a.sort_at || "")));
}

function deviceAvailabilityRows(facts: IntelligenceFact[]) {
  return facts
    .filter((fact) => fact.fact_type === "device_availability")
    .map((fact) => {
      const value = recordOf(fact.value);
      const status = text(value.availability) || "unknown";
      const when = safeDateLabel(fact.occurred_at, "", "relative");
      const room = residentSafeLabel(value.room_name, "");
      const family = text(value.device_family || value.category || value.type) || "device";
      const rawName = residentSafeLabel(fact.object?.label, "");
      const isVirtual = Boolean(value.is_virtual || value.presentation_type === "virtual_appliance" || /ir.*(tv|ac|remote)|virtual/i.test(`${family} ${rawName}`));
      const parentName = residentSafeLabel(value.parent_device_name || value.physical_device_name, "");
      const displayName = rawName && !/^(device|air)$/i.test(rawName)
        ? isVirtual && parentName && !rawName.includes("—") ? `${rawName} — controlled through ${parentName}` : rawName
        : /tv/i.test(family) ? "TV — controlled through Smart IR Hub"
          : /ac|air|climate/i.test(family) ? "AC — controlled through Smart IR Hub"
            : /ir|hub|remote/i.test(family) ? "Smart IR Hub"
              : "Unnamed smart device";
      const explanation = status === "offline"
        ? "Fresh evidence reports this device offline."
        : status === "online"
          ? "Fresh evidence reports this device online."
          : status === "provider_disconnected"
            ? "The provider connection is not available."
            : status === "stale" || status === "expired"
              ? "The latest reading is not recent enough to confirm current availability."
              : "Oyi does not have enough evidence to confirm availability.";
      return {
        device_id: fact.object?.canonical_id || "",
        name: displayName,
        room: room || null,
        device_family: family,
        status,
        last_observed_at: when || null,
        explanation,
      };
    });
}

function walletTransactionRows(facts: IntelligenceFact[]) {
  return facts
    .filter((fact) => fact.fact_type === "wallet_transaction")
    .map((fact) => {
      const value = recordOf(fact.value);
      const amount = Number(value.amount || 0);
      const direction = text(value.direction).toLowerCase();
      const sign = direction === "debit" ? "-" : direction === "credit" ? "+" : "";
      return {
        date: safeDateLabel(fact.occurred_at, "Time unavailable", "date_time"),
        description: residentSafeLabel(value.description || fact.object?.label, "Wallet transaction"),
        type: cleanLabel(value.type, "transaction"),
        amount: `${sign}₦${Math.abs(amount).toLocaleString()}`,
        status: cleanLabel(value.status, "recorded"),
      };
    });
}

export function buildRecentChangesAnswer(facts: IntelligenceFact[], contract: IntelligenceRequestContract, predicates: PresentationFactPredicates) {
  const meaningfulFacts = recentChangeRows(facts, contract, predicates).filter((fact) => safeDateLabel(fact.occurred_at, "")).slice(0, 12);
  const meaningful = groupRecentChangeRows(meaningfulFacts).slice(0, 12);
  predicates.securityRiskAllowed("suspicious_access", meaningfulFacts, 2);
  if (!meaningful.length) {
    if (contract.scope_mode === "exact_target" && contract.target.label) return `I do not see useful recent activity for ${contract.target.label} in the authorised evidence window.`;
    return contract.temporal_scope.mode === "recent"
      ? "I do not see meaningful recent changes in this authorised scope."
      : "I do not see concrete changes for that period in this authorised scope.";
  }
  const from = contract.temporal_scope.from ? safeDateLabel(contract.temporal_scope.from, "the recent window", "date_time") : "the recent window";
  const label = contract.scope_mode === "exact_target" && contract.target.label ? ` for ${contract.target.label}` : "";
  return `${meaningful.length} meaningful change${meaningful.length === 1 ? "" : "s"}${label} were recorded since ${from}. I filtered routine background records and internal checks.`;
}

export function buildCommandOutcomeAnswer(command: Record<string, unknown> | null) {
  if (!command) return "I do not see an authorised recent command execution for this scope.";
  const status = text(command.status);
  const confirmation = text(command.confirmation_status).toLowerCase();
  const physicalStatus = text(command.physical_effect_status).toLowerCase();
  const channel = text(command.channel_code);
  const target = channel ? `${channel.replace(/^switch_/i, "Channel ")}` : "the device";
  const requestedAt = safeDateLabel(command.completed_at || command.requested_at, "", "relative");
  const when = requestedAt ? ` ${requestedAt}` : "";
  if (confirmation === "not_observable" || physicalStatus === "unknown" || physicalStatus === "not_observable") {
    return `Your last ${target} command was accepted by the connected controller${when}. Oyi cannot directly observe whether the physical appliance responded.`;
  }
  if (/state_confirmed|executed/i.test(status) || command.verified) {
    const physical = text(command.physical_effect_status).toLowerCase() === "confirmed"
      ? "Oyi has direct physical-effect evidence for the connected appliance."
      : "The device state was confirmed, but Oyi did not directly observe the connected appliance itself.";
    return `Your last ${target} command was accepted, and a fresh follow-up reading confirmed the requested device state${when}. ${physical}`;
  }
  if (/provider_rejected|failed|state_mismatch|confirmation_timed_out/i.test(status)) {
    return `${target} command did not complete successfully. ${text(command.safe_error_message) || "Oyi kept the last confirmed state rather than marking the device as changed."}`;
  }
  if (/accepted|dispatching|awaiting/.test(status)) return `The controller accepted the ${target} command, but Oyi has not yet confirmed the resulting device state.`;
  return `${target} command was recorded, but Oyi has not confirmed a resulting device-state change.`;
}

export function buildDeviceAvailabilityInventoryAnswer(facts: IntelligenceFact[], contract?: IntelligenceRequestContract, message = "") {
  const availabilityFacts = facts.filter((fact) => fact.fact_type === "device_availability");
  if (!availabilityFacts.length) {
    return contract?.scope_mode === "room_scope"
      ? "I could not load an authorised device inventory for this room. I did not use an old selected device as a fallback."
      : "I could not load a current authorised device inventory for this home. I did not use an old selected device as a fallback.";
  }
  // IQ-9A10 R6: "Is the Living Light on?" names ONE device: answered from that device's own availability record, never from the aggregate of every device.
  // Availability (online/stale/offline) is not power state, so an on/off claim is never made from it.
  const stateAsk = /^\s*(?:is|are)\s+(?:the\s+|my\s+)?(.+?)\s+(on|off)\s*\??\s*$/i.exec(message);
  if (stateAsk) {
    const words = stateAsk[1].toLowerCase().split(/\s+/).filter(w => w.length > 1 && !["the", "my", "our"].includes(w));
    const named = words.length ? availabilityFacts.filter(fact => words.every(w => String(fact.object?.label || "").toLowerCase().includes(w))) : [];
    if (named.length === 1) {
      const f = named[0], av = text(recordOf(f.value).availability) || "unknown";
      const reading = av === "online" ? "it is reporting online" : ["stale", "expired"].includes(av) ? "its latest reading is not current" : av === "offline" ? "it is recorded as offline" : "its availability is unknown";
      return `I can't confirm whether ${f.object?.label || "that device"} is ${stateAsk[2].toLowerCase()}: ${reading}, and these readings show availability, not whether it is switched on or off. Nothing has been sent to it.`;
    }
  }
  const asksForInventory = contract?.scope_mode === "room_scope" && /\b(show|list|view)\b[\s\S]{0,24}\b(devices?|hardware|lights?|switches?|sockets?)\b/i.test(text(message));
  if (/\bonline\b/i.test(message) && !/\boffline\b/i.test(message)) {
    const online = availabilityFacts.filter(fact => recordOf(fact.value).availability === "online");
    return online.length
      ? ["Devices confirmed online from current evidence:", ...online.slice(0, 12).map(fact => `• ${fact.object?.label || "Device"}`)].join("\n")
      : "No authorised devices are confirmed online from current evidence.";
  }
  if (asksForInventory) {
    const unavailable = availabilityFacts.filter((fact) => text(recordOf(fact.value).availability) !== "online").length;
    return `${availabilityFacts.length} authorised device${availabilityFacts.length === 1 ? "" : "s"} are listed for this room.${unavailable ? ` ${unavailable} need attention or clearer evidence.` : " None are currently flagged by the available evidence."}`;
  }
  const confirmedOffline = availabilityFacts.filter((fact) => text(recordOf(fact.value).availability) === "offline");
  const staleOrExpired = availabilityFacts.filter((fact) => ["stale", "expired"].includes(text(recordOf(fact.value).availability)));
  const unknown = availabilityFacts.filter((fact) => text(recordOf(fact.value).availability) === "unknown");
  if (!confirmedOffline.length) {
    const caveat = staleOrExpired.length
      ? ` ${staleOrExpired.length} device${staleOrExpired.length === 1 ? "" : "s"} have stale or expired readings, so I listed them separately instead of calling them offline.`
      : unknown.length
        ? ` ${unknown.length} device${unknown.length === 1 ? "" : "s"} have unknown availability.`
        : "";
    return `I do not see devices that are confirmed offline from fresh evidence in this home.${caveat}`;
  }
  const lines = confirmedOffline.slice(0, 12).map((fact) => {
    const when = safeDateLabel(fact.occurred_at, "", "relative");
    return `• ${fact.object?.label || "Device"}${when ? `, confirmed offline ${when}` : ""}`;
  });
  return ["Confirmed offline devices in this home:", ...lines].join("\n");
}

// Wave 6 Slice 4 -- freshness-safe phrasing for a canonical_awareness fact.
// "current" is the only freshness value allowed present-tense certainty;
// "stale"/"unspecified" are phrased as a past observation, never rewritten
// as current fact (Section 13's invariant).
function freshnessQualifiedStatement(statement: string, freshness: string) {
  const clean = statement.replace(/\.$/, "");
  if (freshness === "current") return `${clean}.`;
  if (freshness === "stale") return `Last observation: ${clean.charAt(0).toLowerCase()}${clean.slice(1)} (this reading is stale).`;
  return `Oyi last noted: ${clean.charAt(0).toLowerCase()}${clean.slice(1)} (freshness not confirmed).`;
}

// Section 11 -- multiple observations belonging to one incident are
// described as ONE coherent problem, not N duplicated lines. Grouping
// relies solely on the incident_id/incident_key the canonical adapter
// already attached to each fact's value -- no new correlation logic.
function groupCanonicalAwarenessFacts(facts: IntelligenceFact[]) {
  const groups = new Map<string, IntelligenceFact[]>();
  const order: string[] = [];
  for (const fact of facts) {
    const value = recordOf(fact.value);
    const key = text(value.incident_id) || fact.fact_id;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(fact);
  }
  return order.map((key) => groups.get(key)!);
}

function urgencyRank(urgency: unknown) {
  const rank: Record<string, number> = { urgent: 3, act: 2, review: 1, monitor: 0 };
  return rank[text(urgency)] ?? 0;
}

export function buildHomeOperationalSummaryAnswer(facts: IntelligenceFact[], contract?: IntelligenceRequestContract, canonicalAwarenessStatus?: "complete" | "partial" | "unavailable") {
  const awarenessFacts = facts.filter((fact) => fact.fact_type === "canonical_awareness");
  const availabilityFacts = facts.filter((fact) => fact.fact_type === "device_availability");
  const recentFacts = facts.filter((fact) => fact.fact_type !== "device_availability" && fact.fact_type !== "canonical_awareness");

  if (awarenessFacts.length) {
    const groups = groupCanonicalAwarenessFacts(awarenessFacts).sort((a, b) => {
      const rankA = Math.max(...a.map((fact) => urgencyRank(recordOf(fact.value).urgency)));
      const rankB = Math.max(...b.map((fact) => urgencyRank(recordOf(fact.value).urgency)));
      return rankB - rankA;
    });
    const scopeLabel = contract?.scope_mode === "room_scope" ? "room" : "home";
    const lines: string[] = [
      `Oyi is currently tracking ${groups.length} active ${groups.length === 1 ? "item" : "items"} for this ${scopeLabel}.`,
    ];
    for (const group of groups.slice(0, 8)) {
      const primary = group[0];
      const primaryValue = recordOf(primary.value);
      lines.push(`• ${freshnessQualifiedStatement(primary.statement, primary.freshness)}`);
      if (group.length > 1) lines.push(`  (${group.length} related observations reviewed together as one item.)`);
      // Section 15: an awareness item's own suggested next step is
      // surfaced as a suggestion, never phrased as a decision or an
      // action already taken.
      const suggestion = text(primaryValue.recommended_action);
      if (suggestion) lines.push(`  Suggested next step: ${suggestion}`);
    }
    if (canonicalAwarenessStatus === "partial") {
      lines.push("Some observations for this scope could not be matched to a scoped record yet, so this list may be incomplete.");
    }
    lines.push(`Oyi did not reuse a selected drawer target or perform any action for this ${scopeLabel}-scope answer.`);
    return lines.join("\n");
  }

  if (canonicalAwarenessStatus === "unavailable") {
    // Section 9 -- UNAVAILABLE is a technical failure, not silence to
    // paper over. Device/recent-change evidence below still answers the
    // turn; this line is the one explicit, observable signal that the
    // awareness layer itself could not be reached this turn.
    return buildDeviceOnlyOperationalSummary(availabilityFacts, recentFacts, contract, "Oyi's operational awareness feed is temporarily unavailable, so this summary is based on device evidence only.");
  }
  if (canonicalAwarenessStatus === "complete" || canonicalAwarenessStatus === "partial") {
    // Section 9 -- EMPTY is a real, positive answer from canonical truth
    // ("nothing active exists"), not a reason to reach for a fallback.
    // Stated explicitly rather than silently omitted, so a caller cannot
    // mistake "canonical said nothing" for "canonical was never asked."
    const note = canonicalAwarenessStatus === "partial"
      ? "Oyi has no active awareness items for this scope right now, though a small number of recent observations could not be scope-matched yet."
      : "Oyi has no active awareness items for this scope right now.";
    return buildDeviceOnlyOperationalSummary(availabilityFacts, recentFacts, contract, note);
  }
  return buildDeviceOnlyOperationalSummary(availabilityFacts, recentFacts, contract, null);
}

function buildDeviceOnlyOperationalSummary(availabilityFacts: IntelligenceFact[], recentFacts: IntelligenceFact[], contract: IntelligenceRequestContract | undefined, leadingNote: string | null) {
  const confirmedOffline = availabilityFacts.filter((fact) => text(recordOf(fact.value).availability) === "offline").length;
  const notRecent = availabilityFacts.filter((fact) => ["stale", "expired", "unknown"].includes(text(recordOf(fact.value).availability))).length;
  const confirmedOnline = availabilityFacts.filter((fact) => text(recordOf(fact.value).availability) === "online").length;
  const attention = recentFacts.filter((fact) => /failed|warning|critical|timeout|unavailable|denied|offline/i.test(`${fact.statement} ${JSON.stringify(fact.value)}`)).slice(0, 5);
  const scopeLabel = contract?.scope_mode === "room_scope" ? "room" : "home";
  const lines = [
    confirmedOffline || notRecent || attention.length
      ? `This ${scopeLabel} is generally stable, but ${confirmedOffline + notRecent + attention.length} item${confirmedOffline + notRecent + attention.length === 1 ? "" : "s"} need attention or clearer evidence.`
      : `Everything currently looks stable in this ${scopeLabel} based on the latest available evidence.`,
    availabilityFacts.length
      ? `Devices: ${confirmedOnline} confirmed online, ${confirmedOffline} confirmed offline, ${notRecent} not recently confirmed.`
      : "Devices: inventory evidence is unavailable right now.",
    attention.length
      ? `Needs attention: ${attention.length} item${attention.length === 1 ? "" : "s"} in the authorised evidence window.`
      : "Needs attention: no urgent item is visible in the authorised evidence window.",
  ];
  if (attention.length) {
    lines.push(...attention.map((fact) => `• ${fact.statement.replace(/\.$/, "")}`));
  }
  lines.push(`Oyi did not reuse a selected drawer target or perform any action for this ${scopeLabel}-scope answer.`);
  return (leadingNote ? [leadingNote, ...lines] : lines).join("\n");
}

export function buildWalletHistoryAnswer(facts: IntelligenceFact[]) {
  const rows = walletTransactionRows(facts);
  if (!rows.length) return "I do not see any wallet transactions in the selected period.";
  return `${rows.length} wallet transaction${rows.length === 1 ? "" : "s"} are available for the selected period. I did not navigate away or perform a financial action.`;
}

export function buildWalletBalanceAnswer(facts: IntelligenceFact[]) {
  if (facts.some((fact) => fact.truth_state === "unavailable")) {
    return "Wallet balance evidence is unavailable right now. I did not treat that as a zero balance.";
  }
  if (!facts.length) return "I do not see a wallet on record for this home.";
  const wallet = facts[0];
  const value = recordOf(wallet.value);
  const balance = Number(value.balance || 0);
  const currency = text(value.currency) || "NGN";
  const frozen = Boolean(value.is_frozen);
  return `Wallet balance: ${currency} ${balance.toLocaleString()}${frozen ? ". This wallet is currently frozen." : "."}`;
}

function maintenanceRequestRows(facts: IntelligenceFact[]) {
  return facts
    .filter((fact) => fact.fact_type === "maintenance_request")
    .map((fact) => {
      const value = recordOf(fact.value);
      return {
        title: residentSafeLabel(value.title || fact.object?.label, "Maintenance request"),
        status: cleanLabel(value.status, "open"),
        priority: cleanLabel(value.priority, "medium"),
        assignee: cleanLabel(value.assigned_to, "Unassigned"),
        date: safeDateLabel(fact.occurred_at, "Time unavailable", "date_time"),
      };
    });
}

export function buildMaintenanceRequestsAnswer(facts: IntelligenceFact[]) {
  const rows = maintenanceRequestRows(facts);
  if (!rows.length) return "I do not see any maintenance requests for this scope.";
  const unresolved = rows.filter((row) => !/closed|resolved|completed/i.test(row.status)).length;
  return `${rows.length} maintenance request${rows.length === 1 ? "" : "s"} are on record${unresolved ? `, ${unresolved} still unresolved` : ""}.`;
}

function visitorAccessRows(facts: IntelligenceFact[]) {
  return facts
    .filter((fact) => fact.fact_type === "visitor_access")
    .map((fact) => {
      const value = recordOf(fact.value);
      return {
        visitor: residentSafeLabel(value.visitor_name || fact.object?.label, "Visitor"),
        status: cleanLabel(value.status, "unknown"),
        purpose: cleanLabel(value.purpose, "Not specified"),
        date: safeDateLabel(fact.occurred_at, "Time unavailable", "date_time"),
      };
    });
}

export function buildVisitorAccessAnswer(facts: IntelligenceFact[]) {
  const rows = visitorAccessRows(facts);
  if (!rows.length) return "I do not see any visitor access records for this scope.";
  const pending = rows.filter((row) => row.status === "pending").length;
  return `${rows.length} visitor access record${rows.length === 1 ? "" : "s"} are on file${pending ? `, ${pending} pending` : ""}. Access codes are never shared in conversation.`;
}

export function tableBlockForContract(contract: IntelligenceRequestContract, facts: IntelligenceFact[], predicates: PresentationFactPredicates, message = ""): ConversationTableBlock | null {
  const snapshot = {
    snapshot_mode: contract.evidence_requirements.current_state || contract.intent === "device_availability_inventory" || contract.intent === "home_operational_summary" ? "current_state_snapshot" : "historical",
    snapshot_generated_at: new Date().toISOString(),
    evidence_cutoff_at: contract.temporal_scope.to || new Date().toISOString(),
    timezone: "UTC",
    scope: contract.scope_mode,
    target: contract.target.label || contract.target.canonical_id || null,
  };
  if (contract.intent === "device_availability_inventory") {
    const rows = deviceAvailabilityRows(facts)
      .filter((row) => /\bonline\b/i.test(message) && !/\boffline\b/i.test(message) ? row.status === "online" : contract.scope_mode === "room_scope" || row.status !== "online")
      .slice(0, 20);
    if (!rows.length) return null;
    return {
      type: "table",
      title: contract.scope_mode === "room_scope" && contract.target.label ? `${contract.target.label} devices` : "Device availability",
      compact: true,
      snapshot,
      columns: [
        { key: "name", label: "Device" },
        { key: "room", label: "Room" },
        { key: "status", label: "Status" },
        { key: "last_observed_at", label: "Last seen" },
        { key: "explanation", label: "Evidence" },
      ],
      rows,
    };
  }
  if (contract.intent === "recent_changes" || contract.intent === "activity_history") {
    const rows = groupRecentChangeRows(recentChangeRows(facts, contract, predicates)).slice(0, 12);
    if (!rows.length) return null;
    return {
      type: "table",
      title: contract.scope_mode === "exact_target"
        ? "Selected target activity"
        : contract.scope_mode === "room_scope" && contract.target.label
          ? `Recent ${contract.target.label} changes`
          : "Recent home changes",
      compact: true,
      snapshot,
      columns: [
        { key: "device_name", label: "Device" },
        { key: "room_name", label: "Room" },
        { key: "channel_label", label: "Channel" },
        { key: "action", label: "Action" },
        { key: "result", label: "Result" },
        { key: "occurred_at", label: "Time" },
      ],
      rows,
    };
  }
  if (contract.intent === "home_operational_summary") {
    const rows = deviceAvailabilityRows(facts).filter((row) => row.status !== "online").slice(0, 8);
    if (!rows.length) return null;
    return {
      type: "table",
      title: contract.scope_mode === "room_scope" && contract.target.label ? `${contract.target.label} attention items` : "Home attention items",
      compact: true,
      snapshot,
      columns: [
        { key: "name", label: "Item" },
        { key: "room", label: "Room" },
        { key: "status", label: "Status" },
        { key: "explanation", label: "Why it matters" },
      ],
      rows,
    };
  }
  if (contract.intent === "wallet_operation" && contract.answer_builder === "wallet_history") {
    const rows = walletTransactionRows(facts).slice(0, 20);
    if (!rows.length) return null;
    return {
      type: "table",
      title: "Wallet history",
      compact: true,
      snapshot,
      columns: [
        { key: "date", label: "Date" },
        { key: "description", label: "Description" },
        { key: "type", label: "Type" },
        { key: "amount", label: "Amount" },
        { key: "status", label: "Status" },
      ],
      rows,
    };
  }
  if (contract.intent === "wallet_operation" && contract.answer_builder === "utility_spending") {
    const rows = utilitySpendingRows(facts);
    if (!rows.length) return null;
    return {
      type: "table",
      title: "Utility spending",
      compact: true,
      snapshot,
      columns: [
        { key: "category", label: "Utility" },
        { key: "amount", label: "Amount" },
        { key: "status", label: "Evidence" },
      ],
      rows,
    };
  }
  return null;
}


// IQ-8: compact structured views of what a read capability found, for answer targeting (list / count / status / yes-no). Same safe labels
// the tables use; visitor access codes are never part of them.
export function maintenanceAnswerRows(facts: IntelligenceFact[]) {
  return { noun: "maintenance requests", singular: "maintenance request", rows: maintenanceRequestRows(facts).map((r) => ({ label: r.title, status: r.status, detail: `${r.priority} priority` })) };
}
export function visitorAnswerRows(facts: IntelligenceFact[]) {
  return { noun: "visitor access records", singular: "visitor access record", rows: visitorAccessRows(facts).map((r) => ({ label: r.visitor, status: r.status, detail: r.purpose === "Not specified" ? undefined : r.purpose })) };
}
export function walletAnswerRows(facts: IntelligenceFact[]) {
  return { noun: "wallet transactions", singular: "wallet transaction", rows: walletTransactionRows(facts).map((r) => ({ label: `${r.description} ${r.amount}`, status: r.status })) };
}
