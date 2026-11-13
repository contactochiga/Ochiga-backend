// Uninspected-attachment honesty guard (Slice 3.1/3.2 hardening). When a WhatsApp customer sends media WITH a caption, Office asks Oyi to answer the caption and
// describes the media only structurally (request.metadata.inbound_message = { message_type, caption_present, attachment_kinds }). Oyi never receives the media
// itself -- no download, no image analysis, no transcription -- so its reply must never claim to have seen, read, heard or understood it. This guard is
// deterministic and applies to the final answer whatever produced it:
//   1. any sentence claiming to have inspected the media is removed;
//   2. a short, factual notice is appended: the attachment was not opened and the reply is based on the customer's message only.
// Pure: no I/O, no AI. Website conversations (no inbound_message metadata) are untouched.

const KIND_NOUNS: Record<string, string> = { image: "photo", video: "video", audio: "audio message", document: "document", sticker: "sticker" };
const MAX_KINDS = 10;

// Media nouns a reply could refer to; an optional adjective or two may sit in front ("your floor plan PDF", "the attached photo").
const MEDIA_NOUN = "(?:image|photo|picture|pic|screenshot|video|clip|recording|voice\\s+note|voice\\s+message|audio|document|file|pdf|attachment|sticker|scan)s?";
const DETERMINER = "(?:your|the|this|that|these|those)";
const CLAIM_PATTERNS: RegExp[] = [
  // "I've looked at your photo", "I can see the attached document", "having reviewed the video", "I listened to your voice note"
  new RegExp(
    `\\b(?:I|I've|I'm|we|we've|having)\\s+(?:(?:have|am|can|could|just|already|now|carefully|quickly)\\s+){0,3}(?:seen|saw|see|viewed|view|looked\\s+at|look\\s+at|looking\\s+at|reviewed|review|reviewing|checked|check|checking|watched|watch|watching|listened\\s+to|listen\\s+to|listening\\s+to|heard|hear|read|reading|opened|open|analy[sz]ed|analy[sz]e|analy[sz]ing|examined|examining|inspected|went\\s+through|gone\\s+through)\\s+${DETERMINER}\\s+(?:[\\w-]+\\s+){0,2}${MEDIA_NOUN}\\b`,
    "i"
  ),
  // "your photo shows ...", "the document says ...", "this video looks ..."
  new RegExp(`\\b${DETERMINER}\\s+(?:[\\w-]+\\s+){0,2}${MEDIA_NOUN}\\s+(?:shows?|showing|looks?|appears?|seems?|contains?|says|mentions?|sounds?|depicts?|indicates?|confirms?|includes?)\\b`, "i"),
  // "in your photo, I can see ...", "from the document, it is clear ..."
  new RegExp(`\\b(?:in|from|on|based\\s+on)\\s+${DETERMINER}\\s+(?:[\\w-]+\\s+){0,2}${MEDIA_NOUN}\\b`, "i"),
  // "nice photo", "great video", "beautiful picture"
  new RegExp(`\\b(?:nice|great|lovely|beautiful|gorgeous|clear|helpful|good|cool|amazing|stunning)\\s+${MEDIA_NOUN}\\b`, "i"),
];

export type InboundAttachmentContext = { kinds: string[] };

// The structural media description Office sent, or null when this turn carried no attachment.
export function inboundAttachmentContext(metadata: Record<string, unknown> | null | undefined): InboundAttachmentContext | null {
  const inbound = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).inbound_message : null;
  const raw = inbound && typeof inbound === "object" ? (inbound as Record<string, unknown>).attachment_kinds : null;
  if (!Array.isArray(raw)) return null;
  const kinds = [...new Set(raw.filter((k): k is string => typeof k === "string" && Object.prototype.hasOwnProperty.call(KIND_NOUNS, k)))].slice(0, MAX_KINDS);
  return kinds.length ? { kinds } : null;
}

export function claimsMediaInspection(sentence: string): boolean {
  return CLAIM_PATTERNS.some((pattern) => pattern.test(sentence));
}

function joinNouns(nouns: string[]): string {
  return nouns.length <= 1 ? nouns[0] || "attachment" : `${nouns.slice(0, -1).join(", ")} and ${nouns[nouns.length - 1]}`;
}

export function uninspectedAttachmentNotice(context: InboundAttachmentContext): string {
  return `I can't open attachments in this chat, so I haven't seen the ${joinNouns(context.kinds.map((k) => KIND_NOUNS[k]))} you sent; my reply is based on your message only.`;
}

export type GuardedAnswer = { answer: string; removed_claims: number; notice_applied: boolean };

export function guardAnswerForUninspectedAttachments(answer: string, context: InboundAttachmentContext | null): GuardedAnswer {
  if (!context) return { answer, removed_claims: 0, notice_applied: false };
  let removed = 0;
  const kept = String(answer || "")
    .split(/\n/)
    .map((line) =>
      (line.match(/[^.!?]+(?:[.!?]+|$)\s*/g) || [])
        .filter((sentence) => {
          if (!claimsMediaInspection(sentence)) return true;
          removed += 1;
          return false;
        })
        .join("")
        .trim()
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const notice = uninspectedAttachmentNotice(context);
  return { answer: kept ? `${kept}\n\n${notice}` : notice, removed_claims: removed, notice_applied: true };
}
