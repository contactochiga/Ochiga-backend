// Generic recipient/person resolution -- reusable across conversation
// actions, automation actions, CRM workflows, tasks, and future
// systems. Office holds the authoritative staff/CRM data (Backend has
// no DB access there); resolution happens via a bridge call to Office's
// own directory/CRM tables (src/services/recipientResolutionService.ts
// -> ochiga-office's recipient-resolution.js), never by inventing a
// contact detail here. See CommunicationRuntime.ts's header note on the
// same "Backend has no DB access into Office" constraint.

export type RecipientEntityType = "staff" | "lead" | "contact" | "explicit" | "authenticated_user";

export type RecipientResolutionSourceKind =
  | "staff_directory"
  | "crm_lead"
  | "crm_contact"
  | "role_resolution"
  | "explicit_address"
  | "authenticated_user"
  | "conversation_context";

export type ResolvedRecipient = {
  recipient_id: string;
  entity_type: RecipientEntityType;
  entity_id: string | null;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  organisation_id: string | null;
  organisation_name: string | null;
  source: RecipientResolutionSourceKind;
  confidence: "high" | "medium" | "low";
  confirmed: boolean;
  available_channels: Array<"email" | "whatsapp" | "sms">;
  // Present for staff entities only -- a deactivated staff member
  // explicitly named must be flagged, never silently redirected to
  // someone else (see Section 15 of the recipient-resolution brief).
  active?: boolean;
};

export type RecipientResolutionResult =
  | { status: "resolved"; recipient: ResolvedRecipient }
  | { status: "ambiguous"; candidates: ResolvedRecipient[] }
  | { status: "not_found" }
  | { status: "unavailable"; reason: string };
