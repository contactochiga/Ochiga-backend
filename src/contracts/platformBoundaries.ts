export const PLATFORM_BOUNDARY_CONTRACT_VERSION = "platform-boundaries.2026-08-11";

export type PlatformSystem =
  | "ochiga-backend"
  | "ochiga-office"
  | "oyi-edge-agent"
  | "oyi-consumer"
  | "oyi-facility"
  | "ochiga-website"
  | "oyi-website";

export type PlatformCapability =
  | "operational_state"
  | "resident_experience"
  | "facility_experience"
  | "edge_runtime"
  | "corporate_crm"
  | "website_intake"
  | "conversation_runtime"
  | "oyi_core_intelligence";

export type PlatformBoundaryContract = {
  id: string;
  version: string;
  producer: PlatformSystem;
  consumers: PlatformSystem[];
  ownerCapability: PlatformCapability;
  transport: "http" | "event" | "shared_contract";
  sourceOfTruth: PlatformSystem;
  compatibility: "preserve_existing_api" | "additive_contract";
  notes: string;
};

export const PLATFORM_SOURCE_OF_TRUTH: Record<PlatformCapability, PlatformSystem> = Object.freeze({
  operational_state: "ochiga-backend",
  resident_experience: "oyi-consumer",
  facility_experience: "oyi-facility",
  edge_runtime: "oyi-edge-agent",
  corporate_crm: "ochiga-office",
  website_intake: "ochiga-office",
  conversation_runtime: "ochiga-backend",
  oyi_core_intelligence: "ochiga-backend",
});

export const PLATFORM_BOUNDARY_CONTRACTS: readonly PlatformBoundaryContract[] = Object.freeze([
  {
    id: "edge-backend-runtime",
    version: PLATFORM_BOUNDARY_CONTRACT_VERSION,
    producer: "oyi-edge-agent",
    consumers: ["ochiga-backend"],
    ownerCapability: "edge_runtime",
    transport: "http",
    sourceOfTruth: "oyi-edge-agent",
    compatibility: "preserve_existing_api",
    notes: "Edge owns local hardware/runtime observations; Backend owns canonical operational state derived from authorised Edge events.",
  },
  {
    id: "office-backend-intelligence-events",
    version: PLATFORM_BOUNDARY_CONTRACT_VERSION,
    producer: "ochiga-office",
    consumers: ["ochiga-backend"],
    ownerCapability: "corporate_crm",
    transport: "event",
    sourceOfTruth: "ochiga-office",
    compatibility: "additive_contract",
    notes: "Office emits material CRM/commercial events; Backend/Oyi Core may consume projections without owning CRM truth.",
  },
  {
    id: "website-office-crm-intake",
    version: PLATFORM_BOUNDARY_CONTRACT_VERSION,
    producer: "ochiga-website",
    consumers: ["ochiga-office"],
    ownerCapability: "website_intake",
    transport: "http",
    sourceOfTruth: "ochiga-office",
    compatibility: "additive_contract",
    notes: "Public websites submit canonical intake envelopes to Office; email remains notification/fallback, not CRM storage.",
  },
  {
    id: "consumer-backend-operational-api",
    version: PLATFORM_BOUNDARY_CONTRACT_VERSION,
    producer: "ochiga-backend",
    consumers: ["oyi-consumer"],
    ownerCapability: "operational_state",
    transport: "http",
    sourceOfTruth: "ochiga-backend",
    compatibility: "preserve_existing_api",
    notes: "Consumer consumes resident-scoped Backend APIs and must not become an operational source of truth.",
  },
  {
    id: "facility-backend-operational-api",
    version: PLATFORM_BOUNDARY_CONTRACT_VERSION,
    producer: "ochiga-backend",
    consumers: ["oyi-facility"],
    ownerCapability: "operational_state",
    transport: "http",
    sourceOfTruth: "ochiga-backend",
    compatibility: "preserve_existing_api",
    notes: "Facility consumes building-scoped Backend APIs and must not receive resident-private device truth unless explicitly authorised.",
  },
  {
    id: "conversation-domain-runtime-boundary",
    version: PLATFORM_BOUNDARY_CONTRACT_VERSION,
    producer: "ochiga-backend",
    consumers: ["oyi-consumer", "oyi-facility"],
    ownerCapability: "conversation_runtime",
    transport: "shared_contract",
    sourceOfTruth: "ochiga-backend",
    compatibility: "additive_contract",
    notes: "Conversation remains one canonical runtime while domain logic migrates into modular contracts, orchestration, presentation and safety modules.",
  },
]);

export function getPlatformBoundaryContract(id: string) {
  return PLATFORM_BOUNDARY_CONTRACTS.find((contract) => contract.id === id) || null;
}

export function assertCapabilityOwner(capability: PlatformCapability, owner: PlatformSystem) {
  return PLATFORM_SOURCE_OF_TRUTH[capability] === owner;
}
