import type { IntelligenceContextEnvelope } from "../contracts/intelligenceContextEnvelope";

export type ModuleFact = {
  adapter: string;
  object_type: string;
  object_id: string | null;
  facts: Record<string, unknown>;
  evidence: Array<Record<string, unknown>>;
  privacy_class: string;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function base(context: Partial<IntelligenceContextEnvelope>, adapter: string): ModuleFact {
  return {
    adapter,
    object_type: text(context.object_type || context.module || adapter) || adapter,
    object_id: text(context.object_id || context.canonical_target?.id) || null,
    privacy_class: text(context.privacy_class) || "organization_restricted",
    facts: {
      surface: context.surface || null,
      module: context.module || adapter,
      route: context.route || null,
      home_id: context.home_id || null,
      building_id: context.building_id || null,
      room_id: context.room_id || null,
      selected_tab: context.selected_tab || null,
    },
    evidence: [],
  };
}

export function buildModuleFacts(context: Partial<IntelligenceContextEnvelope>, visibleData: Record<string, unknown> = {}): ModuleFact {
  const module = text(context.module || context.object_type || "other").toLowerCase();
  const adapter =
    /device/.test(module) ? "device"
    : /room/.test(module) ? "room"
    : /scene/.test(module) ? "scene"
    : /automation/.test(module) ? "automation"
    : /maintenance/.test(module) ? "maintenance"
    : /visitor|access/.test(module) ? "visitor"
    : /wallet|transaction/.test(module) ? "wallet"
    : /service/.test(module) ? "services"
    : /community/.test(module) ? "community"
    : /security|camera|access/.test(module) ? "security"
    : /infrastructure|meter|utility|power|water/.test(module) ? "infrastructure"
    : /digital_twin|twin/.test(module) ? "digital_twin"
    : "other";
  const fact = base(context, adapter);
  fact.facts = {
    ...fact.facts,
    ...visibleData,
    adapter_role: "facts_only",
    recommendation_policy: "oyi_core_only",
    execution_policy: "canonical_safe_action_contract_only",
  };
  fact.evidence = [{ type: "context_envelope", source: "module_fact_adapter", summary: `${adapter} facts collected from current context.`, metadata: { object_id: fact.object_id } }];
  return fact;
}
