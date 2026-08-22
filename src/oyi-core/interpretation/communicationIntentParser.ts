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

const CHANNEL_VERB: Record<string, CommunicationChannelSelector> = {
  email: "email",
  mail: "email",
  whatsapp: "whatsapp",
  text: "sms",
  message: "auto",
  send: "auto",
  forward: "auto",
  tell: "auto",
  call: "voice_call",
  ring: "voice_call",
  phone: "voice_call",
};

const CHANNEL_NOUN: Record<string, CommunicationChannelSelector> = {
  email: "email",
  "e-mail": "email",
  whatsapp: "whatsapp",
  "whatsapp message": "whatsapp",
  sms: "sms",
  text: "sms",
  "text message": "sms",
  message: "auto",
  call: "voice_call",
};

// Recognizes imperative send requests: "email X saying Y", "whatsapp X:
// Y", "send an email to X that Y", "message him saying Y", "call him
// tomorrow" (voice_call has no body -- see below), "mail this to
// Daniel", "forward this to the client". Deliberately conservative --
// requires a leading verb and an explicit content-split marker (or an
// unambiguous recipient token immediately followed by content), so an
// ordinary question mentioning "email" ("what's his email?") is never
// misread as a send request.
export function parseCommunicationSendIntent(rawMessage: string): CommunicationSendIntent | null {
  let message = text(rawMessage);
  if (!message || /\?\s*$/.test(message)) return null;
  // "Reply and tell him I'll call later." / "Reply to her: on my way." --
  // normalize to the existing "tell X Y" shape (channel auto) rather
  // than a separate parsing path. The reply's actual channel is decided
  // by the caller (handleCommunicationTurn), which knows which thread
  // is in focus.
  const replyPrefix = message.match(/^reply\s+(?:and\s+)?(?:tell\s+|to\s+)?(.+)$/i);
  if (replyPrefix) message = `tell ${text(replyPrefix[1])}`;

  // "Give her a call" / "Give him a ring" -- idiom, not the verb-first
  // shape the rest of this parser expects.
  const giveCallMatch = message.match(/^(?:please\s+)?give\s+(him|her|them|me|[^\s]+@[^\s]+|\+?[\d][\d\s-]{7,}|[a-z][a-z .'-]{1,40})\s+a\s+(call|ring)\b\s*(.*)$/i);
  if (giveCallMatch) {
    return { channel: "voice_call", recipientToken: text(giveCallMatch[1]), body: text(giveCallMatch[3]) || "(voice call -- no message body)" };
  }

  const verbMatch = message.match(/^(?:please\s+)?(send|email|mail|whatsapp|message|text|forward|tell|call|ring|phone)\b\s*(.*)$/i);
  if (!verbMatch) return null;
  const verb = verbMatch[1].toLowerCase();
  let rest = text(verbMatch[2]);
  if (!rest) return null;

  let channel: CommunicationChannelSelector = CHANNEL_VERB[verb] || "auto";

  const objectMatch = rest.match(/^(?:an?\s+)?(email|e-mail|whatsapp(?:\s+message)?|sms|text message|message|text|call)\s+(?:to\s+)?(.*)$/i);
  if (objectMatch) {
    const obj = objectMatch[1].toLowerCase();
    if (CHANNEL_NOUN[obj]) channel = CHANNEL_NOUN[obj];
    rest = text(objectMatch[2]);
  } else {
    rest = rest.replace(/^to\s+/i, "");
  }
  if (!rest) return null;

  // voice_call has no "saying" content split -- "call him tomorrow
  // afternoon" / "ring the client" carry no message body at all.
  if (channel === "voice_call") {
    const tokenMatch = rest.match(/^(me|him|her|them|the\s+[a-z][a-z\s]{1,40}?|[^\s]+@[^\s]+|\+?[\d][\d\s-]{7,}|[a-z][a-z .'-]{1,40})(?:\s+(.*))?$/i);
    if (!tokenMatch) return null;
    return { channel, recipientToken: text(tokenMatch[1]), body: text(tokenMatch[2]) || "(voice call -- no message body)" };
  }

  const splitMatch = rest.match(/^(.+?)\s+(?:saying|that|to say)\s*[:,]?\s*(.+)$/i) || rest.match(/^([^:]+):\s*(.+)$/);
  let recipientToken: string;
  let body: string;
  if (splitMatch) {
    recipientToken = text(splitMatch[1]);
    body = text(splitMatch[2]);
  } else {
    const tokenMatch = rest.match(/^(me|him|her|them|the\s+[a-z][a-z\s]{1,40}?|[^\s]+@[^\s]+|\+?[\d][\d\s-]{7,})\s+(.*)$/i);
    if (!tokenMatch) return null;
    recipientToken = text(tokenMatch[1]);
    body = text(tokenMatch[2]);
  }
  if (!body) return null;
  return { channel, recipientToken: recipientToken.replace(/^(that|to)\s+/i, "").trim(), body };
}

export type ChannelReuseIntent = {
  // The channel to send on -- always explicit here (that's the whole
  // point of this pattern: "send it on WhatsApp too").
  channel: CommunicationChannelSelector;
  // A NEW recipient token, when the phrase names one ("send the same to
  // Ada"); null means "reuse the same recipient as before" too.
  recipientToken: string | null;
};

// "Send it on WhatsApp too." / "Send that on WhatsApp as well." /
// "Send the same to Ada." / "Do the same for the other contact." --
// reuses the last confirmed communication's content (and usually its
// recipient), changing only the channel and/or recipient. Distinct from
// parseCommunicationSendIntent, which always requires a fresh body.
export function parseChannelReuseIntent(rawMessage: string): ChannelReuseIntent | null {
  const message = text(rawMessage);
  if (!message || /\?\s*$/.test(message)) return null;

  const channelOnly = message.match(/^(?:please\s+)?send\s+(?:it|that|this)\s+(?:on|via|by)\s+(email|e-mail|whatsapp|sms|text)\s*(?:too|as well)?\.?$/i);
  if (channelOnly) {
    return { channel: CHANNEL_NOUN[channelOnly[1].toLowerCase()] || "auto", recipientToken: null };
  }

  const sameToSomeone = message.match(/^(?:please\s+)?(?:send|do)\s+the\s+same\s+(?:thing|message)?\s*(?:for|to)\s+(.+?)\.?$/i);
  if (sameToSomeone) {
    return { channel: "auto", recipientToken: text(sameToSomeone[1]) };
  }

  return null;
}

export type CommunicationRevisionIntent = { additionalText: string };

// "Actually add that the meeting is Thursday." / "Also mention we
// received the drawings." -- appends to a PENDING (unconfirmed)
// communication's body rather than replacing it or being read as a new
// send request. Only meaningful while a communication is pending; the
// caller is responsible for checking that.
export function parseCommunicationRevisionIntent(rawMessage: string): CommunicationRevisionIntent | null {
  const message = text(rawMessage);
  if (!message) return null;
  const match = message.match(/^(?:actually\s+|also\s+)?(?:add|mention|include|say)\s+(?:that\s+)?(.+)$/i);
  if (!match) return null;
  const additionalText = text(match[1]);
  if (!additionalText) return null;
  return { additionalText };
}

// Resolves ONLY what's determinable from the token itself plus the
// authenticated actor's own on-file email -- no CRM/DB lookups here.
// Returns null, never a guessed address, for anything that needs a real
// directory/CRM lookup (a bare name, a pronoun, a role phrase) -- the
// caller (ConversationOrchestrator.ts's handleCommunicationTurn) is
// responsible for routing those through recipientResolutionService.ts
// and/or personContext.ts instead.
export function resolveCommunicationRecipientTokenHint(
  recipientToken: string,
  actor: { id?: string | null; email?: string | null } | null
): Partial<CommunicationRecipient> | null {
  const trimmed = recipientToken.trim();
  const token = trimmed.toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { email: trimmed };
  }
  // The WHOLE trimmed token must be phone-shaped -- not "contains
  // digits somewhere" (e.g. "an SMS to +234..." must NOT resolve to a
  // phone number; only an unambiguous bare number does).
  if (/^\+?[\d][\d\s-]{6,16}\d$/.test(trimmed)) {
    return { phone: trimmed, whatsapp_phone: trimmed };
  }
  if (token === "me") {
    const email = actor?.email || null;
    if (!email) return null;
    return { email, user_id: actor?.id || null };
  }
  return null;
}

// True for a token that needs directory/CRM/continuity resolution
// rather than being resolvable from the token text alone -- pronouns
// referring to the person currently "in focus", or a bare name/role
// phrase ("Daniel", "the Head of Sales", "David Okoro").
const PRONOUN_TOKENS = ["him", "her", "them", "he", "she", "they"];

export function isPersonLookupToken(recipientToken: string): boolean {
  const token = recipientToken.trim().toLowerCase();
  if (!token) return false;
  if (PRONOUN_TOKENS.includes(token)) return true;
  if (resolveCommunicationRecipientTokenHint(recipientToken, null)) return false;
  if (token === "me") return false;
  // A bare 1-2 letter token ("he" already handled above as a pronoun,
  // but guards any other short leftover) is too short to be a genuine
  // directory search -- a substring ilike match against it would hit
  // unrelated records purely by coincidence (e.g. "he" inside "Check").
  if (token.length < 3) return false;
  return true;
}

export function isPronounToken(recipientToken: string): boolean {
  return PRONOUN_TOKENS.includes(recipientToken.trim().toLowerCase());
}

// "What did you just send?" / "was that delivered?" / "did that email
// go through?" -- Phase K/L, a status lookup against the most recently
// dispatched communication, not a new send request.
export function isCommunicationHistoryQuery(rawMessage: string): boolean {
  const message = text(rawMessage).toLowerCase();
  if (!message) return false;
  return (
    /\b(what did (you|i) (just )?send)\b/.test(message) ||
    /\b(was (that|it|the (email|message|whatsapp|text)) (sent|delivered))\b/.test(message) ||
    /\b(did (that|it|the) (email|message|whatsapp|text)?\s*(go through|send|deliver|get sent|get delivered))\b/.test(message) ||
    /\b(is (that|it) delivered)\b/.test(message) ||
    /\b(did (he|she|they) (get|receive) (it|that))\b/.test(message)
  );
}

// "Who is this?" / "Open the Daniel lead." / "Who is handling this
// partnership?" -- a person-lookup-and-set-context turn, not a send.
// Distinguishes a genuine lookup from an ordinary question by requiring
// one of a small set of person-focused openers.
export function parsePersonLookupIntent(rawMessage: string): { query: string; queryType: "auto" | "role" } | null {
  const message = text(rawMessage);
  if (!message) return null;
  const openLead = message.match(/^(?:open|show|pull up)\s+(?:the\s+)?(.+?)\s+(?:lead|contact)\.?$/i);
  if (openLead) return { query: text(openLead[1]), queryType: "auto" };
  const whoIs = message.match(/^who\s+is\s+(?:this|handling\s+this\s+(?:partnership|opportunity|deal|account))\??$/i);
  if (whoIs) return null; // resolved from active context elsewhere, not a fresh directory search
  const whoIsNamed = message.match(/^who\s+is\s+(?!this\b|he\b|she\b|it\b)([a-z][a-z .'-]{1,40})\??$/i);
  if (whoIsNamed) return { query: text(whoIsNamed[1]), queryType: "auto" };
  return null;
}

export type ReplyOrThreadQuery =
  | { kind: "reply_status"; recipientToken: string | null }
  | { kind: "reply_content"; recipientToken: string | null }
  | { kind: "thread_history"; recipientToken: string | null };

const REPLY_TOKEN = "(him|her|them|he|she|they|the\\s+[a-z][a-z\\s]{1,40}?|[a-z][a-z .'-]{1,40})";

// "Has he replied?" / "Did she reply?" / "Has the lead responded?" --
// distinct from isCommunicationHistoryQuery (which asks about the
// runtime's own OUTBOUND send/delivery state), this asks about a real
// INBOUND reply from the other party.
export function parseReplyOrThreadQuery(rawMessage: string): ReplyOrThreadQuery | null {
  const message = text(rawMessage);
  if (!message) return null;

  const threadHistory = message.match(/^(?:show\s+me\s+|show\s+)?(?:our|the)\s+(?:whatsapp\s+)?conversation\s+with\s+(.+?)\.?\??$/i);
  if (threadHistory) return { kind: "thread_history", recipientToken: text(threadHistory[1]) };

  const statusMatch = message.match(new RegExp(`^(?:has|did)\\s+${REPLY_TOKEN}\\s+repl(?:y|ied)\\??$`, "i"));
  if (statusMatch) return { kind: "reply_status", recipientToken: text(statusMatch[1]) };

  const contentMatch = message.match(new RegExp(`^what\\s+(?:did|was)\\s+${REPLY_TOKEN}(?:'s)?\\s+(?:say|reply|response)\\??$`, "i"));
  if (contentMatch) return { kind: "reply_content", recipientToken: text(contentMatch[1]) };

  return null;
}
