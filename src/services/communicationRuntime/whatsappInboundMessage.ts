// WhatsApp inbound message normalization (Slice 3.1/3.2 media contract). Office forwards, besides the customer's typed `text`, an optional
// `message_type`, `caption` and media `attachments` metadata (Ochiga-office whatsapp-media.js). This module turns that request body into the parts of the
// canonical inbound event, keeping the three apart:
//   * body          : the customer's own words that classification, opt-out governance and goals read -- typed text, else the caption, else "".
//                     Never a placeholder: a media message without a caption has an empty body (classified "unknown", exactly as today).
//   * message_type  : what the provider reported ("text" when Office did not say -- an older Office), else "unknown" for an unrecognised value.
//   * caption       : kept as its own field, even when it also became the body.
//   * attachments   : metadata only (provider media id, MIME type, size, SHA-256, filename, voice/animated flags). url is always null: Backend never receives
//                     media bytes, a provider URL or a storage URL. Unknown keys are dropped; values are type-checked and length-capped.
// Pure: no I/O.
import type { CommunicationAttachment } from "../../contracts/communication";

export const INBOUND_MEDIA_KINDS = ["image", "video", "audio", "document", "sticker"] as const;
export type InboundMediaKind = (typeof INBOUND_MEDIA_KINDS)[number];

const MAX_ATTACHMENTS = 10;
const MAX_CAPTION = 4096;

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function mimeType(value: unknown): string | null {
  const v = str(value, 127).toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(\s*;\s*[a-z0-9_.-]+=[a-z0-9_.\-"]+)*$/.test(v) ? v : null;
}

function displayFilename(value: unknown): string | null {
  const base = str(value, 512).split(/[\\/]/).pop() || "";
  const safe = base.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255);
  return safe || null;
}

function sizeBytes(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export function normalizeInboundMessageType(value: unknown): string {
  if (value === undefined || value === null || value === "") return "text";
  const v = str(value, 40).toLowerCase();
  return /^[a-z_]{1,40}$/.test(v) ? v : "unknown";
}

export function normalizeInboundAttachments(value: unknown): CommunicationAttachment[] | null {
  if (!Array.isArray(value)) return null;
  const out: CommunicationAttachment[] = [];
  // the first MAX_ATTACHMENTS valid entries, scanning a bounded number of inputs
  for (const raw of value.slice(0, MAX_ATTACHMENTS * 5)) {
    if (out.length >= MAX_ATTACHMENTS) break;
    if (!raw || typeof raw !== "object") continue;
    const a = raw as Record<string, unknown>;
    const kind = str(a.kind, 20).toLowerCase();
    const providerMediaId = str(a.provider_media_id, 128);
    if (!(INBOUND_MEDIA_KINDS as readonly string[]).includes(kind) || !providerMediaId) continue;
    const mime = mimeType(a.mime_type);
    const filename = kind === "document" ? displayFilename(a.filename) : null;
    out.push({
      filename: filename || "",
      content_type: mime,
      url: null,
      kind: kind as InboundMediaKind,
      provider_media_id: providerMediaId,
      mime_type: mime,
      size_bytes: sizeBytes(a.size_bytes),
      sha256: str(a.sha256, 128) || null,
      voice: kind === "audio" && a.voice === true,
      animated: kind === "sticker" && a.animated === true,
      office_file_id: str(a.office_file_id, 128) || null,
    });
  }
  return out.length ? out : null;
}

export type NormalizedWhatsAppInboundMessage = {
  body: string;
  body_source: "text" | "caption" | "none";
  message_type: string;
  caption: string | null;
  attachments: CommunicationAttachment[] | null;
};

export function normalizeWhatsAppInboundMessage(requestBody: Record<string, unknown>): NormalizedWhatsAppInboundMessage {
  const text = String(requestBody.text || "");
  const caption = str(requestBody.caption, MAX_CAPTION);
  // an older Office sends no caption: the body is then exactly the text it sent, as before
  const body = text.trim() ? text : caption || text;
  return {
    body,
    body_source: text.trim() ? "text" : caption ? "caption" : "none",
    message_type: normalizeInboundMessageType(requestBody.message_type),
    caption: caption || null,
    attachments: normalizeInboundAttachments(requestBody.attachments),
  };
}
