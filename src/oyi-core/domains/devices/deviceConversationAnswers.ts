import type {
  CanonicalConversationRequest,
  CanonicalConversationResponse,
  IntelligenceFact,
  OperationalObject,
} from "../../contracts/canonicalConversation";
import type { OisContext } from "../../../types/oisContext";
import type { IntelligenceRequestContract } from "../../interpretation/conversationIntentRouting";
import { freshnessLabelFromEvidence, safeDateLabel } from "../../presentation/timeFreshness";

type DeviceAnswerDependencies = {
  factFromObject: (
    object: OperationalObject,
    hydrationFacts: Record<string, unknown>,
    input: CanonicalConversationRequest,
    oisContext: OisContext | null | undefined,
  ) => IntelligenceFact;
  factAppliesToContract: (fact: IntelligenceFact, contract: IntelligenceRequestContract) => boolean;
  isFailureFact: (fact: IntelligenceFact) => boolean;
  listNames: (value: unknown, fallbackPrefix: string) => string[];
  arrayOfStrings: (value: unknown) => string[];
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function human(value: unknown) {
  return text(value).replace(/_/g, " ");
}

function naturalState(value: unknown) {
  const raw = human(value).toLowerCase();
  if (!raw) return "";
  const map: Record<string, string> = {
    on: "ON",
    off: "OFF",
    online: "online",
    offline: "offline",
    healthy: "healthy",
    normal: "normal",
    degraded: "degraded",
    unavailable: "unavailable",
    pending: "pending",
    "pending confirmation": "waiting for confirmation",
    active: "active",
    inactive: "inactive",
    open: "open",
    closed: "closed",
    resolved: "resolved",
    failed: "not completed",
  };
  return map[raw] || human(value);
}

function channelSummary(facts: Record<string, unknown>) {
  const channels = recordOf(facts.channels);
  const states = recordOf(channels.switch_states);
  const entries = Object.entries(states).filter(([, value]) => typeof value === "boolean");
  if (!entries.length) return "";
  return entries.map(([code, value]) => `${code.replace(/^switch_/i, "Channel ")} is ${value ? "On" : "Off"}`).join("; ");
}

function providerHealthLabel(value: unknown) {
  const raw = text(recordOf(value).status || value).toLowerCase();
  if (!raw) return "unknown";
  if (["healthy", "online", "connected", "ok"].includes(raw)) return "healthy";
  if (["offline", "disconnected", "provider_disconnected", "reconnect_required"].includes(raw)) return "unavailable";
  return raw;
}

function providerHealthSentence(provider: string, evidence: ReturnType<typeof freshnessLabelFromEvidence>) {
  if (provider === "unknown") return "";
  if (evidence.current) return `Controller connection is ${provider}.`;
  if (provider === "healthy") return `The last available controller reading looked healthy, but it is not live evidence.`;
  if (provider === "unavailable") return `The controller connection was not available in the latest evidence.`;
  return `Controller connection in the latest evidence: ${provider}.`;
}

export function buildDeviceCurrentStateAnswer(
  object: OperationalObject | null,
  hydrationFacts: Record<string, unknown>,
  contract: IntelligenceRequestContract,
  dependencies: Pick<DeviceAnswerDependencies, "factFromObject">,
) {
  if (!object) return "I do not have an exact object selected, so I can only answer from the current authorised scope.";
  const stateFacts = recordOf(hydrationFacts.state);
  const channelLine = channelSummary(hydrationFacts);
  const provider = providerHealthLabel(stateFacts.provider_health || recordOf(object.metadata).provider_health);
  const freshness = text(stateFacts.freshness || object.freshness);
  const truth = freshnessLabelFromEvidence(
    freshness,
    dependencies.factFromObject(object, hydrationFacts, { message: "", surface: "consumer" } as CanonicalConversationRequest, null).truth_state,
    recordOf(object.metadata).source,
    stateFacts.runtime_timestamp || object.freshness,
  );
  const state = naturalState(object.current_state) || "an unavailable state";
  const lines = truth.prefix.includes("for")
    ? [`Oyi ${truth.prefix} ${object.label}.`]
    : [`${object.label} ${truth.prefix} ${state}.`];
  if (object.health) lines.push(truth.current ? `Health is ${naturalState(object.health)}.` : `Last health reading: ${naturalState(object.health)}.`);
  const providerLine = providerHealthSentence(provider, truth);
  if (providerLine) lines.push(providerLine);
  if (channelLine) lines.push(channelLine.endsWith(".") ? channelLine : `${channelLine}.`);
  if (truth.caveat) lines.push(truth.caveat);
  if (object.object_type === "device_channel" && contract.target.channel_code) lines.push(`This answer is scoped only to ${contract.target.channel_code}; I did not substitute another channel.`);
  return lines.join(" ");
}

export function buildDeviceHealthAnswer(
  object: OperationalObject | null,
  hydrationFacts: Record<string, unknown>,
  dependencies: Pick<DeviceAnswerDependencies, "factFromObject">,
) {
  if (!object) return "I could not verify the selected object from the current authorised scope.";
  const stateFacts = recordOf(hydrationFacts.state);
  const provider = providerHealthLabel(stateFacts.provider_health || recordOf(object.metadata).provider_health);
  const state = naturalState(object.current_state) || "unknown";
  const channelLine = channelSummary(hydrationFacts);
  const truth = freshnessLabelFromEvidence(
    stateFacts.freshness || object.freshness,
    dependencies.factFromObject(object, hydrationFacts, { message: "", surface: "consumer" } as CanonicalConversationRequest, null).truth_state,
    recordOf(object.metadata).source,
    stateFacts.runtime_timestamp || object.freshness,
  );
  const status = truth.current && (provider === "healthy" || /online|available|healthy|connected/i.test(`${object.health || ""} ${stateFacts.availability || ""}`));
  const lead = status
    ? `${object.label} is communicating with Oyi from fresh confirmed evidence.`
    : `Oyi cannot claim a live healthy connection for ${object.label} from the current evidence.`;
  return [
    lead,
    truth.current ? `It currently reports ${state}.` : `${object.label} ${truth.prefix} ${state}.`,
    object.health ? (truth.current ? `Health is ${naturalState(object.health)}.` : `Last health reading: ${naturalState(object.health)}.`) : "",
    providerHealthSentence(provider, truth),
    channelLine ? `${channelLine}.` : "",
    truth.caveat,
  ].filter(Boolean).join(" ");
}

export function buildDeviceFailureHistoryAnswer(
  facts: IntelligenceFact[],
  contract: IntelligenceRequestContract,
  dependencies: Pick<DeviceAnswerDependencies, "factAppliesToContract" | "isFailureFact">,
) {
  const failures = facts.filter((fact) => dependencies.factAppliesToContract(fact, contract) && dependencies.isFailureFact(fact)).slice(0, 8);
  const label = contract.target.label || "the selected device";
  if (!failures.length) return `I do not see confirmed failures for ${label} in the authorised evidence window. Stale, expired, or unknown readings were not counted as failures.`;
  return [`Failures for ${label}:`, ...failures.map((fact) => {
    const at = safeDateLabel(fact.occurred_at, "");
    return `• ${fact.statement.replace(/\.$/, "")}${at ? ` (${at})` : ""}`;
  })].join("\n");
}

export function buildDeviceDiagnosisAnswer(
  object: OperationalObject | null,
  hydrationFacts: Record<string, unknown>,
  facts: IntelligenceFact[],
  contract: IntelligenceRequestContract,
  dependencies: Pick<DeviceAnswerDependencies, "factFromObject" | "factAppliesToContract" | "isFailureFact">,
) {
  if (!object) return "I could not diagnose an exact selected object in this scope.";
  const stateFacts = recordOf(hydrationFacts.state);
  const failures = facts.filter((fact) => dependencies.factAppliesToContract(fact, contract) && dependencies.isFailureFact(fact));
  const provider = providerHealthLabel(stateFacts.provider_health || recordOf(object.metadata).provider_health);
  const state = naturalState(object.current_state) || "unknown";
  const channelLine = channelSummary(hydrationFacts);
  const freshness = freshnessLabelFromEvidence(
    stateFacts.freshness || object.freshness,
    dependencies.factFromObject(object, hydrationFacts, { message: "", surface: "consumer" } as CanonicalConversationRequest, null).truth_state,
    recordOf(object.metadata).source,
    stateFacts.runtime_timestamp || object.freshness,
  );
  const nextStep = failures.length
    ? "Safe next step: retry only after checking the provider connection or review the last failed command."
    : provider === "unavailable"
      ? "Safe next step: reconnect or refresh the controller integration before relying on live state."
      : "Safe next step: use a direct control only if you want to change the state; this diagnosis did not execute anything.";
  return [
    `Finding: ${failures.length ? `${failures.length} confirmed failure item${failures.length === 1 ? "" : "s"} are visible for ${object.label}.` : `No confirmed failure is visible for ${object.label}.`}`,
    `Supporting evidence: ${freshness.current ? "The latest reading confirms" : freshness.prefix} ${state}.`,
    channelLine ? `Channels: ${channelLine}.` : "",
    providerHealthSentence(provider, freshness),
    `Evidence freshness: ${freshness.caveat || "Freshness is not available."}`,
    failures[0] ? `Most relevant issue: ${failures[0].statement.replace(/\.$/, "")}.` : "",
    `Uncertainty: relay or controller state does not independently prove the physical appliance output.`,
    nextStep,
    "No action was performed.",
  ].filter(Boolean).join(" ");
}

export function buildDeviceRelationshipsAnswer(
  object: OperationalObject | null,
  input: CanonicalConversationRequest,
  hydrationFacts: Record<string, unknown>,
  contract: IntelligenceRequestContract,
  dependencies: Pick<DeviceAnswerDependencies, "listNames" | "arrayOfStrings">,
) {
  if (!object) return "I could not load relationships for an exact selected object in this scope.";
  const relationships = { ...recordOf(object.relationships), ...recordOf(hydrationFacts.relationships), ...recordOf(input.relationships) };
  const scenes = dependencies.listNames(input.active_scenes || relationships.active_scenes || relationships.scenes, "scene");
  const automations = dependencies.listNames(input.active_automations || relationships.active_automations || relationships.automations, "automation");
  const controls = dependencies.arrayOfStrings(recordOf(hydrationFacts.classification).supported_controls || object.capabilities).slice(0, 6);
  const selected = recordOf(hydrationFacts.selected_channel);
  const channel = contract.target.channel_code ? `Selected channel: ${text(recordOf(selected.channel).name || recordOf(selected.channel).label) || contract.target.channel_code.replace(/^switch_/i, "Channel ")}.` : "";
  const roomName = text(relationships.room_name);
  const homeLabel = text(relationships.home_name || recordOf(hydrationFacts.identity).home_name);
  const lines = [
    `Relationships for ${object.label}:`,
    text(relationships.parent_device_name) ? `Parent hub: ${text(relationships.parent_device_name)}.` : "",
    channel,
    roomName ? `Room: ${roomName}.` : "",
    homeLabel ? `Home: ${homeLabel}.` : "",
    scenes.length ? `Scenes: ${scenes.slice(0, 4).join(", ")}.` : "Scenes: none linked in the current evidence.",
    automations.length ? `Automations: ${automations.slice(0, 4).join(", ")}.` : "Automations: none linked in the current evidence.",
    controls.length ? `Supported controls: ${controls.join(", ")}.` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

export function buildDeviceControlProposal(input: {
  contract: IntelligenceRequestContract;
  object: OperationalObject;
}) {
  const { contract, object } = input;
  const targetLabel = contract.target.label || object.label;
  const state = text(contract.mutation.command || contract.mutation.desired_state);
  const answer = state
    ? `I found ${targetLabel}. Please confirm before I send the ${state.toUpperCase()} command. No command was sent yet.`
    : `I found ${targetLabel}, but I need the exact command before sending anything. No command was sent.`;
  const execution = {
    status: "pending_confirmation",
    current_turn_execution: false,
    target_id: contract.target.canonical_id,
    channel_code: contract.target.channel_code,
    command: contract.mutation.command,
    desired_state: contract.mutation.desired_state,
  };
  const confirmations: CanonicalConversationResponse["confirmations"] = state ? [{
    type: "device_command_confirmation",
    target_id: contract.target.canonical_id,
    target_type: contract.target.object_type,
    label: targetLabel,
    channel_code: contract.target.channel_code,
    command: contract.mutation.command,
    desired_state: contract.mutation.desired_state,
    risk: "device_control",
  }] : [];
  return {
    answer,
    understood: `Prepared a safe confirmation for ${targetLabel}.`,
    execution,
    confirmations,
  };
}
