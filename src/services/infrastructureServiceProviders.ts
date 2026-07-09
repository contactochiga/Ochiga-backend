export type ServiceKey =
  | "utility_token"
  | "water_service"
  | "gas_service"
  | "internet_service"
  | "fiber_internet"
  | "generator_recovery"
  | "solar_battery_service"
  | "service_charge"
  | "other_facility_fees";

export type InfrastructureProviderType =
  | "electricity_vending"
  | "water_billing"
  | "internet_provider"
  | "gas_provider"
  | "generator_recovery"
  | "solar_battery";

export type ProviderHealthStatus = "online" | "degraded" | "offline" | "unknown";
export type VendingReadiness = "ready" | "pending" | "unsupported" | "issues";

export type ProviderHealth = {
  status: ProviderHealthStatus;
  readiness: VendingReadiness;
  supported: boolean;
  lastCheckedAt: string;
  reason: string | null;
};

export type ProviderExecutionResult = {
  accepted: boolean;
  status: "pending_provider" | "manual_review" | "unsupported";
  settlementStatus: "pending" | "unsupported";
  reason: string;
  providerReference: string | null;
};

export type InfrastructureServiceProvider = {
  key: InfrastructureProviderType;
  label: string;
  health(input: { provider?: string | null; linked?: boolean; status?: string | null; metadata?: Record<string, any> | null }): ProviderHealth;
  execute(input: {
    provider?: string | null;
    accountRef?: string | null;
    amount?: number | null;
    serviceKey: ServiceKey;
    transactionType: string;
    metadata?: Record<string, any> | null;
  }): Promise<ProviderExecutionResult>;
};

const NOW = () => new Date().toISOString();

function buildHealth(input: {
  provider?: string | null;
  linked?: boolean;
  status?: string | null;
  metadata?: Record<string, any> | null;
  providerType: InfrastructureProviderType;
}): ProviderHealth {
  const statusText = String(input.status || "").toLowerCase();
  const provider = String(input.provider || input.metadata?.provider || "").trim();
  const linked = Boolean(input.linked);
  if (!provider || !linked) {
    return {
      status: "unknown",
      readiness: "pending",
      supported: false,
      lastCheckedAt: NOW(),
      reason: !provider ? "provider_unconfigured" : "service_not_linked",
    };
  }
  if (/issue|offline|failed|blocked|suspended/.test(statusText)) {
    return {
      status: "degraded",
      readiness: "issues",
      supported: false,
      lastCheckedAt: NOW(),
      reason: "service_status_requires_attention",
    };
  }
  return {
    status: "online",
    readiness: input.providerType === "electricity_vending" ? "ready" : "pending",
    supported: false,
    lastCheckedAt: NOW(),
    reason: input.providerType === "electricity_vending"
      ? "provider_ready_for_authorized_vending_integration"
      : "provider_placeholder_adapter_not_live",
  };
}

function placeholderProvider(key: InfrastructureProviderType, label: string): InfrastructureServiceProvider {
  return {
    key,
    label,
    health(input) {
      return buildHealth({ ...input, providerType: key });
    },
    async execute(input) {
      const reason = key === "electricity_vending"
        ? "authorized_vending_provider_not_integrated"
        : "provider_adapter_placeholder";
      return {
        accepted: false,
        status: key === "electricity_vending" ? "pending_provider" : "manual_review",
        settlementStatus: "unsupported",
        reason: `${label} request recorded but live provider execution is not enabled yet`,
        providerReference: `${input.serviceKey}:${Date.now()}:${reason}`,
      };
    },
  };
}

const PROVIDERS: Record<InfrastructureProviderType, InfrastructureServiceProvider> = {
  electricity_vending: placeholderProvider("electricity_vending", "Electricity Vending"),
  water_billing: placeholderProvider("water_billing", "Water Billing"),
  internet_provider: placeholderProvider("internet_provider", "Internet Provider"),
  gas_provider: placeholderProvider("gas_provider", "Gas Provider"),
  generator_recovery: placeholderProvider("generator_recovery", "Generator Recovery"),
  solar_battery: placeholderProvider("solar_battery", "Solar / Battery"),
};

export function providerTypeForService(serviceKey: ServiceKey): InfrastructureProviderType {
  if (serviceKey === "utility_token") return "electricity_vending";
  if (serviceKey === "water_service") return "water_billing";
  if (serviceKey === "gas_service") return "gas_provider";
  if (serviceKey === "internet_service" || serviceKey === "fiber_internet") return "internet_provider";
  if (serviceKey === "generator_recovery") return "generator_recovery";
  return "solar_battery";
}

export function getInfrastructureServiceProvider(serviceKey: ServiceKey) {
  return PROVIDERS[providerTypeForService(serviceKey)];
}
