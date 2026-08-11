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
        transaction_id: fact.object?.canonical_id || fact.fact_id,
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
  const asksForInventory = contract?.scope_mode === "room_scope" && /\b(show|list|view)\b[\s\S]{0,24}\b(devices?|hardware|lights?|switches?|sockets?)\b/i.test(text(message));
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

export function buildHomeOperationalSummaryAnswer(facts: IntelligenceFact[], contract?: IntelligenceRequestContract) {
  const availabilityFacts = facts.filter((fact) => fact.fact_type === "device_availability");
  const recentFacts = facts.filter((fact) => fact.fact_type !== "device_availability");
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
  return lines.join("\n");
}

export function buildWalletHistoryAnswer(facts: IntelligenceFact[]) {
  const rows = walletTransactionRows(facts);
  if (!rows.length) return "I do not see any wallet transactions in the selected period.";
  return `${rows.length} wallet transaction${rows.length === 1 ? "" : "s"} are available for the selected period. I did not navigate away or perform a financial action.`;
}

export function tableBlockForContract(contract: IntelligenceRequestContract, facts: IntelligenceFact[], predicates: PresentationFactPredicates): ConversationTableBlock | null {
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
      .filter((row) => contract.scope_mode === "room_scope" || row.status !== "online")
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
