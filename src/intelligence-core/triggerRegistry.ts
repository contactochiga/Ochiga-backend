// Facility Automation -- Cross-Domain Fabric Closure.
//
// A canonical catalog of event_type strings that already flow through the
// one true intelligence-event choke point, publishIntelligenceEvent
// (eventBus.ts). This is READ metadata only -- it does not itself publish
// anything. It exists so (a) GET /facility/automation/capabilities can
// describe real trigger options instead of a single hardcoded schedule
// entry, and (b) facility_automation_event_rules can be validated against
// a known-real event_type at create time.
//
// Deliberately excluded: wallet.* (Finance has no safe paired action and no
// overdue/failed-payment signal exists), and any direct-message/
// Communications event (no canonical send-message service or bus event
// exists yet). Both gaps are disclosed in the final report, not silently
// hidden by pretending an entry exists.
export type TriggerFieldType = "number" | "string";

export type TriggerCapability = {
  event_type: string;
  domain: string;
  label: string;
  description: string;
  // Numeric/string payload fields on this event's metadata.payload that are
  // safe to threshold against via the field_threshold condition. Empty for
  // events with no meaningful payload fields (e.g. device online/offline).
  fields?: Array<{ key: string; type: TriggerFieldType; label: string }>;
};

export const TRIGGER_REGISTRY: TriggerCapability[] = [
  { event_type: "device.online", domain: "devices", label: "Device came online", description: "A registered device reported an online transition." },
  { event_type: "device.offline", domain: "devices", label: "Device went offline", description: "A registered device reported an offline transition." },
  {
    event_type: "weather.condition.observed",
    domain: "environment",
    label: "Weather condition observed",
    description: "A fresh outdoor weather observation was recorded for this Facility.",
    fields: [
      { key: "temperature", type: "number", label: "Outdoor temperature (°C)" },
      { key: "wind_speed", type: "number", label: "Wind speed (km/h)" },
      { key: "precipitation_probability", type: "number", label: "Rain probability (%)" },
      { key: "humidity", type: "number", label: "Humidity (%)" },
    ],
  },
  { event_type: "visitor_access.created", domain: "visitors", label: "Visitor invite created", description: "A new visitor access record was created." },
  { event_type: "visitor_access.approved", domain: "visitors", label: "Visitor approved", description: "A visitor's access was approved." },
  { event_type: "visitor_access.denied", domain: "visitors", label: "Visitor denied", description: "A visitor's access was denied." },
  { event_type: "visitor_access.used", domain: "visitors", label: "Visitor arrived", description: "A visitor's access code was used to enter." },
  { event_type: "visitor_access.exited", domain: "visitors", label: "Visitor exited", description: "A visitor's exit was recorded." },
  { event_type: "maintenance.created", domain: "maintenance", label: "Work order created", description: "A new maintenance request was submitted." },
  { event_type: "maintenance.assigned", domain: "maintenance", label: "Work order assigned", description: "A maintenance request was assigned." },
  { event_type: "maintenance.completed", domain: "maintenance", label: "Work order completed", description: "A maintenance request was marked completed." },
  { event_type: "maintenance.cancelled", domain: "maintenance", label: "Work order cancelled", description: "A maintenance request was cancelled." },
  { event_type: "security.incident.created", domain: "security", label: "Security incident created", description: "A new facility security incident was recorded." },
  { event_type: "community.post.created", domain: "community", label: "Community post created", description: "A new community post was published." },
  { event_type: "community.post.moderated", domain: "community", label: "Community post moderated", description: "A community post's moderation status changed." },
  { event_type: "home.service_registry.updated", domain: "buildings", label: "Home service registry updated", description: "A home's service/account bindings changed." },
  { event_type: "home.utility_account.updated", domain: "buildings", label: "Home utility account updated", description: "A home's utility account linkage changed." },
];

export function getTriggerCapability(eventType: string): TriggerCapability | null {
  return TRIGGER_REGISTRY.find((t) => t.event_type === eventType) || null;
}

export function isRegisteredTriggerEventType(eventType: string): boolean {
  return Boolean(getTriggerCapability(eventType));
}
