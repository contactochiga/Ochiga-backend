import type { AdapterContext, DiscoveredDevice } from "../device/adapters/types";

export type DiscoveryClassification =
  | "compatible"
  | "needs_adapter"
  | "needs_edge"
  | "needs_credentials"
  | "unsupported"
  | "unknown";

export type InfrastructureCandidateType =
  | "device"
  | "camera"
  | "dvr_nvr"
  | "gateway"
  | "controller"
  | "meter"
  | "access_system"
  | "edge_node"
  | "sensor"
  | "power_system"
  | "infrastructure_asset"
  | "service"
  | "system"
  | "unknown";

export type ProviderAuthenticationMethod =
  | "none"
  | "linked_account"
  | "oauth"
  | "api_token"
  | "username_password"
  | "qr_pairing"
  | "local_credentials"
  | "pair_button"
  | "device_pin"
  | "network_pairing";

export type ProviderImplementationState = "active" | "manual_import" | "adapter_required" | "future";
export type ProviderDiscoveryMode = "cloud" | "local_network" | "edge" | "manual";

export type InfrastructureProviderManifest = {
  key: string;
  label: string;
  adapter_key?: string | null;
  implementation: ProviderImplementationState;
  discovery_mode: ProviderDiscoveryMode;
  authentication_methods: ProviderAuthenticationMethod[];
  object_types: InfrastructureCandidateType[];
  protocols: string[];
  requires_edge: boolean;
  supports_discovery: boolean;
  supports_import: boolean;
  supports_verification: boolean;
  notes?: string;
};

export type OnboardingActor = {
  id: string;
  role?: string | null;
  email?: string | null;
  estate_id?: string | null;
  home_id?: string | null;
};

export type ProviderDiscoveryInput = {
  provider: InfrastructureProviderManifest;
  adapterContext: AdapterContext;
  estateId: string;
  sessionId: string;
  hasOnlineEdge: boolean;
  allowLocalScan?: boolean;
};

export type NormalizedDiscoveryCandidate = {
  provider_key: string;
  adapter_key: string;
  identity_key: string;
  external_id: string | null;
  candidate_type: InfrastructureCandidateType;
  name: string;
  category: string | null;
  classification: DiscoveryClassification;
  classification_reason: string;
  online: boolean | null;
  capabilities: string[];
  protocols: string[];
  provider_metadata: Record<string, unknown>;
};

export type VerificationCheckState = "passed" | "conditional" | "failed" | "not_applicable";

export type OnboardingVerificationCheck = {
  key: "identity" | "communication" | "command" | "state" | "permissions" | "relationships" | "runtime" | "duplicate_detection";
  state: VerificationCheckState;
  summary: string;
  evidence?: Record<string, unknown>;
};

export function candidateTypeForDevice(device: DiscoveredDevice): InfrastructureCandidateType {
  const category = String(device.category || "").toLowerCase();
  const haystack = [category, device.name, ...(device.capabilities || [])].join(" ").toLowerCase();
  if (category === "camera" || /camera|onvif|rtsp/.test(haystack)) return "camera";
  if (category === "gateway" || /gateway|hub|bridge|coordinator/.test(haystack)) return "gateway";
  if (category === "sensor" || /sensor|detector|temperature|humidity/.test(haystack)) return "sensor";
  if (/meter|energy_meter|water_meter|smart_meter/.test(haystack)) return "meter";
  if (/access|gate|door_controller|intercom/.test(haystack)) return "access_system";
  if (/inverter|solar|battery|generator|ups|power_system/.test(haystack)) return "power_system";
  return "device";
}
