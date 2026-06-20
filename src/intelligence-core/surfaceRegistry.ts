import type { IntelligenceMemoryScope, IntelligenceSurface } from "./types";

export type OyiSurfaceDefinition = {
  id: IntelligenceSurface;
  label: string;
  memory_scopes: IntelligenceMemoryScope[];
  allowed_domains: string[];
  allowed_actions: string[];
  event_categories: string[];
  response_tone: string;
  fallback_behavior: "awareness" | "conversation" | "operational";
};

const sharedDomains = ["awareness", "investigation", "capability_query", "recommendation", "general_help"];

export const OYI_SURFACE_REGISTRY: Record<IntelligenceSurface, OyiSurfaceDefinition> = {
  consumer: { id: "consumer", label: "Oyi Home", memory_scopes: ["user", "home", "estate"], allowed_domains: [...sharedDomains, "devices", "visitors", "maintenance", "wallet", "services", "community"], allowed_actions: ["read", "prepare_confirmed_action"], event_categories: ["visitor", "maintenance", "device", "wallet", "service", "community", "security"], response_tone: "calm household intelligence", fallback_behavior: "awareness" },
  facility: { id: "facility", label: "Oyi Facility", memory_scopes: ["estate", "facility"], allowed_domains: [...sharedDomains, "visitors", "maintenance", "devices", "security", "camera", "utilities", "community", "wallet"], allowed_actions: ["read", "prepare_confirmed_action"], event_categories: ["security", "visitor", "maintenance", "device", "camera", "utility", "wallet", "community", "service"], response_tone: "operations assistant", fallback_behavior: "operational" },
  office: { id: "office", label: "Ochiga Office", memory_scopes: ["office", "lead", "company"], allowed_domains: [...sharedDomains, "leads", "sales", "deployments", "partners"], allowed_actions: ["read", "prepare_confirmed_action"], event_categories: ["office", "lead", "marketing", "sales", "workflow", "support"], response_tone: "executive operations assistant", fallback_behavior: "conversation" },
  oma: { id: "oma", label: "OMA", memory_scopes: ["lead", "office"], allowed_domains: ["lead_qualification", "marketing", "recommendation"], allowed_actions: ["read", "prepare_confirmed_action"], event_categories: ["lead", "marketing", "office"], response_tone: "commercial qualification assistant", fallback_behavior: "conversation" },
  osa: { id: "osa", label: "OSA", memory_scopes: ["lead", "office"], allowed_domains: ["sales", "proposal", "recommendation"], allowed_actions: ["read", "prepare_confirmed_action"], event_categories: ["lead", "sales", "office", "workflow"], response_tone: "commercial conversion assistant", fallback_behavior: "conversation" },
  edge: { id: "edge", label: "Oyi Edge", memory_scopes: ["edge", "estate"], allowed_domains: ["health", "camera", "infrastructure"], allowed_actions: ["read"], event_categories: ["edge", "camera", "device", "system"], response_tone: "technical runtime assistant", fallback_behavior: "operational" },
  camera: { id: "camera", label: "Oyi Camera", memory_scopes: ["camera", "estate", "edge"], allowed_domains: ["camera", "security", "investigation"], allowed_actions: ["read"], event_categories: ["camera", "security", "edge"], response_tone: "security intelligence assistant", fallback_behavior: "operational" },
  watch: { id: "watch", label: "Oyi Watch", memory_scopes: ["user", "home"], allowed_domains: ["presence", "safety", "awareness"], allowed_actions: ["read"], event_categories: ["security", "device", "system"], response_tone: "personal safety assistant", fallback_behavior: "awareness" },
  twin: { id: "twin", label: "Oyi Twin", memory_scopes: ["estate", "facility", "office"], allowed_domains: ["model", "simulation", "investigation"], allowed_actions: ["read"], event_categories: ["system", "device", "camera", "utility"], response_tone: "operational modeling assistant", fallback_behavior: "conversation" },
  plan_studio: { id: "plan_studio", label: "Plan Studio", memory_scopes: ["office", "company"], allowed_domains: ["planning", "recommendation", "workflow"], allowed_actions: ["read", "prepare_confirmed_action"], event_categories: ["office", "workflow", "prediction"], response_tone: "planning assistant", fallback_behavior: "conversation" },
  website: { id: "website", label: "Website", memory_scopes: ["lead"], allowed_domains: ["lead_qualification", "general_help"], allowed_actions: ["read"], event_categories: ["lead", "marketing"], response_tone: "helpful commercial guide", fallback_behavior: "conversation" },
  whatsapp: { id: "whatsapp", label: "WhatsApp", memory_scopes: ["lead", "user"], allowed_domains: [...sharedDomains], allowed_actions: ["read"], event_categories: ["lead", "support", "system"], response_tone: "concise assistant", fallback_behavior: "conversation" },
  widget: { id: "widget", label: "Widget", memory_scopes: ["lead"], allowed_domains: ["lead_qualification", "general_help"], allowed_actions: ["read"], event_categories: ["lead", "marketing"], response_tone: "helpful commercial guide", fallback_behavior: "conversation" },
  api: { id: "api", label: "API", memory_scopes: ["system"], allowed_domains: [...sharedDomains], allowed_actions: ["read"], event_categories: ["system"], response_tone: "system integration", fallback_behavior: "conversation" },
};

export function getOyiSurfaceDefinition(surface: unknown): OyiSurfaceDefinition {
  const key = String(surface || "consumer").trim().toLowerCase() as IntelligenceSurface;
  return OYI_SURFACE_REGISTRY[key] || OYI_SURFACE_REGISTRY.consumer;
}
