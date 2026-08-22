// Oyi Communication Runtime -- Live Reply Loop programme. ONE shared
// inbound-reply classifier, reused by the general inbound pipeline
// (inboundEventPipeline.ts, stored on oyi_communications.outcome_*) and
// by goal evaluation's success/stop-condition checks
// (goalRuntime/goalEvaluator.ts) -- deliberately not a second, parallel
// intelligence system. Reuses the SAME OpenAI client/credential pattern
// already established in goalEvaluator.ts (src/utils/ai.ts's own
// OPENAI_API_KEY). Never fabricates a classification: unreachable/
// unconfigured/unparseable always returns "unknown" with confidence 0,
// and callers must treat "unknown" as "no signal," never as any
// particular business outcome.
import OpenAI from "openai";
import type { InboundReplyClassification, InboundReplyOutcome } from "../../contracts/communication";

const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const VALID_OUTCOMES: InboundReplyOutcome[] = [
  "acknowledgement",
  "interested",
  "not_interested",
  "positive_reply",
  "negative_reply",
  "request_more_info",
  "request_proposal_or_document",
  "callback_request",
  "reschedule_request",
  "meeting_request",
  "payment_confirmation",
  "complaint",
  "support_request",
  "unsubscribe",
  "wrong_person",
  "identity_question",
  "human_required",
  "ambiguous",
];

const UNKNOWN: InboundReplyClassification = { outcome: "unknown", confidence: 0, evidence: "" };

// A small, honest keyword pre-check for the one outcome that MUST be
// caught even if the OpenAI call is unavailable -- opt-out governance
// (Program A item 8) cannot depend on a third-party API being up.
// Deliberately narrow (exact STOP-family words only) to avoid a false
// positive silently opting someone out.
const STOP_PATTERN = /^\s*(?:please\s+)?(stop|unsubscribe|opt\s*out|remove me|don'?t (contact|message|text|email|call) me( again)?|leave me alone|no more messages)\s*[.!]?\s*$/i;

export function quickUnsubscribeCheck(text: string): boolean {
  return STOP_PATTERN.test(String(text || "").trim());
}

export async function classifyInboundReply(text: string): Promise<InboundReplyClassification> {
  const trimmed = String(text || "").trim();
  if (!trimmed) return UNKNOWN;
  if (quickUnsubscribeCheck(trimmed)) {
    return { outcome: "unsubscribe", confidence: 1, evidence: trimmed.slice(0, 200) };
  }
  if (!openaiClient) return UNKNOWN;
  try {
    const response = await openaiClient.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            `Classify a business SMS/WhatsApp/email reply into exactly ONE of these labels: ${VALID_OUTCOMES.join(", ")}, or "unknown" if truly unclear. ` +
            `Reply with STRICT JSON only: {"outcome":"<label>","confidence":<0-1 number>,"evidence":"<short quote or paraphrase from the message that justifies the label>"}. ` +
            `Guidance: "acknowledgement" = a bare ok/thanks/noted with no other content. "interested"/"positive_reply" = agreement, enthusiasm, or a clear next step forward. "not_interested"/"negative_reply" = decline. "request_more_info" = asks a question about the offer itself. "request_proposal_or_document" = explicitly asks for a document/proposal/quote. "callback_request" = asks to be called. "reschedule_request" = asks to move a scheduled time. "meeting_request" = asks to meet. "payment_confirmation" = confirms a payment was made/received. "complaint" = expresses a problem or dissatisfaction. "support_request" = asks for help with something already in use. "wrong_person" = says this isn't the intended recipient. "identity_question" = asks who is texting / what this is about. "human_required" = explicitly asks to speak to a person, not a bot. "ambiguous" = genuinely unclear intent. Never use "unsubscribe" -- that is handled separately.`,
        },
        { role: "user", content: trimmed.slice(0, 1500) },
      ],
      max_tokens: 150,
      temperature: 0,
      response_format: { type: "json_object" },
    });
    const raw = response.choices[0]?.message?.content?.trim() || "";
    const parsed = JSON.parse(raw);
    const outcome = String(parsed.outcome || "").trim() as InboundReplyOutcome;
    if (!VALID_OUTCOMES.includes(outcome)) return UNKNOWN;
    const confidence = typeof parsed.confidence === "number" && parsed.confidence >= 0 && parsed.confidence <= 1 ? parsed.confidence : 0.5;
    const evidence = typeof parsed.evidence === "string" ? parsed.evidence.slice(0, 300) : "";
    return { outcome, confidence, evidence };
  } catch {
    return UNKNOWN;
  }
}

// Coarse positive/negative/neutral mapping for goal success/stop-
// condition checks (goalEvaluator.ts) -- reuses the SAME classification
// call above rather than a second sentiment prompt.
export function coarseSentimentFromOutcome(outcome: InboundReplyOutcome): "positive" | "negative" | "neutral" | "unknown" {
  if (["interested", "positive_reply", "payment_confirmation", "meeting_request", "acknowledgement"].includes(outcome)) return "positive";
  if (["not_interested", "negative_reply", "complaint", "unsubscribe", "wrong_person"].includes(outcome)) return "negative";
  if (outcome === "unknown") return "unknown";
  return "neutral";
}
