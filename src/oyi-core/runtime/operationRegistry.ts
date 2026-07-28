export type OperationRiskClass = "low" | "medium" | "high" | "critical";
export type OperationPlanType = "suggest_only" | "prepare_workflow" | "request_approval" | "executable_action";

export type RegisteredOperation = {
  id: string;
  domain: string;
  targetType: string;
  mutationClass: "read" | "write" | "sensitive_write" | "financial" | "security";
  reversible: boolean;
  riskClass: OperationRiskClass;
  requiredPermissions: string[];
  approvalRequired: boolean;
  verificationRequired: boolean;
  confirmationStrategy: "none" | "provider_ack_only" | "observable_state" | "manual_confirmation" | "event_confirmed";
  prohibitedPrivacyClasses: string[];
};

const operations = new Map<string, RegisteredOperation>();

function register(operation: RegisteredOperation) {
  operations.set(operation.id, operation);
}

register({
  id: "maintenance.prepare_workflow",
  domain: "maintenance",
  targetType: "maintenance_request",
  mutationClass: "write",
  reversible: true,
  riskClass: "low",
  requiredPermissions: ["support.assign"],
  approvalRequired: false,
  verificationRequired: true,
  confirmationStrategy: "manual_confirmation",
  prohibitedPrivacyClasses: ["smart_access_private"],
});

register({
  id: "infrastructure.request_verification",
  domain: "infrastructure",
  targetType: "infrastructure_asset",
  mutationClass: "read",
  reversible: true,
  riskClass: "low",
  requiredPermissions: ["devices.read"],
  approvalRequired: false,
  verificationRequired: true,
  confirmationStrategy: "manual_confirmation",
  prohibitedPrivacyClasses: ["resident_device_private", "smart_access_private"],
});

register({
  id: "notification.prepare_notice",
  domain: "communication",
  targetType: "notification",
  mutationClass: "write",
  reversible: true,
  riskClass: "medium",
  requiredPermissions: ["notifications.manage"],
  approvalRequired: true,
  verificationRequired: true,
  confirmationStrategy: "manual_confirmation",
  prohibitedPrivacyClasses: ["smart_access_private"],
});

export function getRegisteredOperation(id: string) {
  return operations.get(id) || null;
}

export function listRegisteredOperations() {
  return [...operations.values()];
}

export function operationPlanType(operationId: string | null | undefined): OperationPlanType {
  if (!operationId) return "suggest_only";
  const operation = getRegisteredOperation(operationId);
  if (!operation) return "suggest_only";
  if (operation.approvalRequired) return "request_approval";
  if (operation.mutationClass === "read") return "prepare_workflow";
  return operation.riskClass === "low" ? "executable_action" : "request_approval";
}
