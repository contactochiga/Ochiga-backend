// Oyi Communication Actions Runtime -- pure NL parsing, split out from
// ConversationOrchestrator.ts so it's importable in isolation by smoke
// tests (that file cannot be safely imported directly in a test process
// -- see other *-smoke.mjs scripts' "no ConversationOrchestrator.js
// import in this process" header notes).
import type { CommunicationChannelSelector, CommunicationRecipient } from "../../contracts/communication";

export type CommunicationSendIntent = {
  channel: CommunicationChannelSelector;
  recipientToken: string;
  body: string;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

// Recognizes imperative send requests: "email X saying Y", "whatsapp X:
// Y", "send an email to X that Y", "message him saying Y". Deliberately
// conservative -- requires a leading send/email/whatsapp/message/text
// verb and an explicit content-split marker (or an unambiguous recipient
// token immediately followed by content), so an ordinary question
// mentioning "email" ("what's his email?") is never misread as a send
// request.
export function parseCommunicationSendIntent(rawMessage: string): CommunicationSendIntent | null {
  const message = text(rawMessage);
  if (!message || /\?\s*$/.test(message)) return null;
  const verbMatch = message.match(/^(?:please\s+)?(send|email|whatsapp|message|text)\b\s*(.*)$/i);
  if (!verbMatch) return null;
  const verb = verbMatch[1].toLowerCase();
  let rest = text(verbMatch[2]);
  if (!rest) return null;

  let channel: CommunicationChannelSelector = "auto";
  if (verb === "email") channel = "email";
  else if (verb === "whatsapp") channel = "whatsapp";

  const objectMatch = rest.match(/^(?:an?\s+)?(email|whatsapp(?:\s+message)?|message|text)\s+(?:to\s+)?(.*)$/i);
  if (objectMatch) {
    const obj = objectMatch[1].toLowerCase();
    if (obj.startsWith("email")) channel = "email";
    else if (obj.startsWith("whatsapp")) channel = "whatsapp";
    rest = text(objectMatch[2]);
  } else {
    rest = rest.replace(/^to\s+/i, "");
  }
  if (!rest) return null;

  const splitMatch = rest.match(/^(.+?)\s+(?:saying|that|to say)\s*[:,]?\s*(.+)$/i) || rest.match(/^([^:]+):\s*(.+)$/);
  let recipientToken: string;
  let body: string;
  if (splitMatch) {
    recipientToken = text(splitMatch[1]);
    body = text(splitMatch[2]);
  } else {
    const tokenMatch = rest.match(/^(me|him|her|them|[^\s]+@[^\s]+|\+?[\d][\d\s-]{7,})\s+(.*)$/i);
    if (!tokenMatch) return null;
    recipientToken = text(tokenMatch[1]);
    body = text(tokenMatch[2]);
  }
  if (!body) return null;
  return { channel, recipientToken: recipientToken.replace(/^(that|to)\s+/i, "").trim(), body };
}

// Resolves ONLY what's determinable from the token itself plus the
// authenticated actor's own on-file email -- no CRM/DB lookups (Backend
// has no DB access to Office's lead/contact tables; see
// CommunicationRuntime.ts's header note). Returns null, never a guessed
// address, when the token can't be resolved this way (e.g. "him"/"her"
// with no selected-contact continuity slot to resolve against -- see
// ConversationOrchestrator.ts's handleCommunicationTurn for that
// documented gap).
export function resolveCommunicationRecipientTokenHint(
  recipientToken: string,
  actor: { id?: string | null; email?: string | null } | null
): Partial<CommunicationRecipient> | null {
  const token = recipientToken.toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientToken)) {
    return { email: recipientToken };
  }
  const digits = recipientToken.replace(/[^\d+]/g, "");
  if (/^\+?\d{8,15}$/.test(digits)) {
    return { phone: recipientToken, whatsapp_phone: recipientToken };
  }
  if (token === "me") {
    const email = actor?.email || null;
    if (!email) return null;
    return { email, user_id: actor?.id || null };
  }
  return null;
}
