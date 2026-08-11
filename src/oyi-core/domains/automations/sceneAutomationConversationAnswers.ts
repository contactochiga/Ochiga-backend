import type {
  OperationalObject,
  OperationalObjectType,
} from "../../runtime/canonicalConversationRuntime";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function naturalizeUserCopy(value: string) {
  return value
    .replace(/\bentity\b/gi, "record")
    .replace(/\btool\b/gi, "action")
    .replace(/\bworkflow\b/gi, "request")
    .replace(/\s+/g, " ")
    .trim();
}

export function sceneAutomationObjectProfile(objectType: OperationalObjectType): { role: string; diagnostics: string[]; actions: string[] } {
  if (objectType === "scene") {
    return {
      role: "I coordinate the devices and conditions attached to this scene without treating it as a text macro.",
      diagnostics: ["included devices", "last run", "failures", "schedule"],
      actions: ["review", "run with confirmation", "show devices"],
    };
  }
  return {
    role: "I track this automation's trigger, conditions, actions, and last execution.",
    diagnostics: ["trigger", "conditions", "last run", "affected objects"],
    actions: ["review", "draft changes", "enable or disable with confirmation"],
  };
}

export function sceneAutomationObjectVoice(objectType: OperationalObjectType) {
  if (objectType === "scene") {
    return {
      healthy: "The scene definition is available.",
      unavailable: "I can't verify this scene right now.",
      next: "Would you like to review devices, run history, or prepare to run it?",
    };
  }
  return {
    healthy: "The automation definition is available.",
    unavailable: "I can't verify this automation right now.",
    next: "Would you like trigger details, run history, or a draft change?",
  };
}

export function sceneAutomationRecommendation(object: OperationalObject) {
  if (object.object_type === "scene") return "I recommend reviewing the affected devices before running this scene.";
  return "I recommend checking the trigger, conditions, and last run before changing this automation.";
}

export function sceneAutomationConfirmationReply(object: OperationalObject, response: Record<string, unknown>) {
  const execution = recordOf(response.execution);
  const confirmations = Array.isArray(response.confirmations) ? response.confirmations.map(recordOf) : [];
  const pending = confirmations[0] || recordOf((Array.isArray(execution.results) ? execution.results : []).map(recordOf).find((row) => row.status === "pending_confirmation"));
  const summary = text(pending.summary || pending.title || execution.summary || response.understood);
  if (object.object_type === "scene") {
    return summary
      ? `${naturalizeUserCopy(summary)} Should I continue to the scene review?`
      : `This may run device actions for ${object.label}. Should I continue to review?`;
  }
  return summary
    ? `${naturalizeUserCopy(summary)} Should I continue to the automation review?`
    : `This changes automation behavior for ${object.label}. Should I continue to review?`;
}

export function sceneAutomationContextualActions(object: OperationalObject) {
  const action = (label: string, prompt: string, risk = "read") => ({
    label,
    prompt,
    risk,
    operational_object: {
      object_type: object.object_type as OperationalObjectType,
      canonical_id: object.canonical_id,
    },
  });
  if (object.object_type === "scene") {
    return [
      action("Devices", "What devices does this scene control?"),
      action("History", "When did this scene last run?"),
      action("Run", "Run this scene", "approval"),
      action("Edit", "Edit this scene", "approval"),
    ];
  }
  return [
    action("Status", "Is this automation active?"),
    action("Trigger", "What triggers this automation?"),
    action("History", "Show recent runs"),
    action("Edit", "Change this automation", "approval"),
  ];
}

export function buildSceneAutomationReadAnswer(records: Array<Record<string, unknown>>, domain: "scenes" | "automations") {
  if (!records.length) return domain === "scenes"
    ? "I do not see any authorized scenes in the current context."
    : "I do not see any authorized automations in the current context.";
  const filtered = records.filter((record) => domain === "scenes" ? record.object_type !== "automation" : record.object_type === "automation");
  const visible = filtered.length ? filtered : records;
  const lines = visible.slice(0, 3).map((record) => {
    const name = text(record.name || record.id) || (domain === "scenes" ? "Scene" : "Automation");
    const status = record.last_run_status ? `last run ${record.last_run_status}` : record.enabled === null ? "" : record.enabled ? "enabled" : "disabled";
    const count = Number(record.action_count || 0) ? `${Number(record.action_count)} actions` : "";
    return [name, status, count].filter(Boolean).join(" - ");
  });
  return `I found ${visible.length} authorized ${domain}. ${lines.join(" ")}`.trim();
}

export function buildSceneAutomationReviewAnswer(intent: "scene_execution" | "automation_operation", domain: "scenes" | "automations") {
  if (intent === "scene_execution") {
    return "I can prepare this scene run for review, but I will not run any device actions until the scene action path validates permissions and confirmation.";
  }
  return domain === "automations"
    ? "I can prepare an automation draft or lifecycle change for review, but I will not enable, disable, save, or delete anything without approval."
    : "I can prepare a scene draft or update for review, but I will not save or run anything without approval.";
}
