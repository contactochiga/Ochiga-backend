import { analyse } from "../interpretation/semanticObjective";
import type { AnswerTarget } from "./answerTarget";

// IQ-8 limitation targeting: when no enabled capability or evidence source can answer, the answer names the SPECIFIC thing the user asked for
// that is unavailable, instead of a generic "I understand the request" or a catalogue of what Oyi can do. It never claims a state it cannot read.
const DET = new Set(["the", "my", "our", "your", "any", "a", "an", "this", "that", "these", "those"]);
const FLIP: Record<string, string> = { my: "your", me: "you", i: "you", our: "our", mine: "yours" };

export function topicPhrase(question: string): string {
  const T = analyse(question).tokens;
  const start = T.findIndex((t, i) => i > 0 && DET.has(t));
  const body = (start >= 0 ? T.slice(start) : T.slice(1)).map(t => FLIP[t] ?? t);
  const trimmed = body.filter((t, i) => !(i === 0 && DET.has(t) && t !== "your" && t !== "our"));
  return trimmed.slice(0, 8).join(" ").replace(/\s+/g, " ").trim();
}

export function isGenericUnsupportedAnswer(answer: string): boolean {
  return /^I can (?:help with|tell you about) /.test(answer) || /^I understand the request, but Oyi does not have an enabled governed capability/.test(answer)
    || /^I understand this as an? [a-z_ ]+ request, but (?:that capability is not available in this release yet|I can’t confirm it from an enabled capability yet)/.test(answer)
    || /^That [a-z_ ]+ capability is not available from this surface right now/.test(answer);
}

export function limitationAnswer(target: AnswerTarget, question: string): string {
  if (target.response_intent === "CLARIFICATION") return clarificationQuestion(target);
  if (target.response_intent === "REFUSAL" && target.refusal_kind === "unverified_assurance") return "I can't tell you that: I have no evidence it is true, and saying so could leave you or others unprotected. I can tell you what is recorded, and I can't verify the rest.";
  if (target.response_intent === "REFUSAL" && target.refusal_kind === "internal") return "I can't share how Ochiga assesses opportunities internally: scoring rules and criteria aren't something I disclose, whatever role is claimed.";
  if (target.response_intent === "REFUSAL" && target.refusal_kind === "commitment") return "I can't give you a figure or a price: any valuation or offer is made by Ochiga's team after a proper review, and I can't commit Ochiga to one.";
  if (target.response_intent === "REFUSAL" && target.refusal_kind === "authority") return "I can't do that: I won't ignore or bypass privacy, permission or authority boundaries, whatever role is claimed.";
  if (target.response_intent === "REFUSAL") return "I can't say who is responsible: attributing a problem to a person is not something the evidence supports, and I won't guess or name anyone.";
  const asked = question.replace(/\s+/g, " ").trim().slice(0, 120);
  if (target.facet === "usage") return "I can't tell you how much was used: consumption (usage) readings are not available yet.";
  const measure = target.response_intent === "LIMITATION" ? analyse(question).tokens.find(t => ["temperature", "humidity", "noise", "decibels", "airflow", "pollution"].includes(t)) : undefined;
  if (measure) return `I don't have ${measure} data: no ${measure} sensor reading is available to me here, so I can't tell you what it is.`;
  const lead = target.response_intent === "YES_NO_WITH_REASON" || target.response_intent === "ACTION_RESULT" ? "I can't tell" : "I can't answer that";
  return `${lead}: there is no enabled evidence source on this surface that could answer “${asked}” yet, so I would only be guessing.`;
}

/** An authority denial states WHY (scope, surface or permission) without widening anything; unknown reasons keep the generic refusal. */
export function denialAnswer(reason: string | null | undefined, asked: string, act = false): string {
  const q = asked ? ` (“${asked}”)` : "";
  // the established denial sentence is kept verbatim (it is the product's safe-denial contract); the reason follows it
  const base = `I can't do that for you here: you are not authorised to use it from this surface or scope${q}`;
  if (reason === "home_scope_required" || reason === "room_scope_required") return act
    ? `${base} — it needs a specific home or room in scope, and this view has no estate-wide control. Nothing has been changed.`
    : `${base} — it needs a specific home or room in scope, and this view has no estate-wide read for it.`;
  if (reason === "requested_scope_not_authorized") return `${base} — I can only show information for your own home; another resident's, a neighbour's or estate-wide details aren't available to you here, whatever role is claimed.`;
  if (reason === "estate_scope_required") return `${base} — it needs an estate in scope.`;
  if (reason === "surface_not_supported" || reason === "public_corporate_surface_cannot_use_operational_capability") return `${base} — that isn't available from this surface.`;
  if (reason === "missing_permission") return `${base} — your role doesn't have the permission it needs.`;
  return `${base}.`;
}

/** The specific question that resolves an ambiguity the path already knows about. Never a menu, never "nothing pending". */
export function clarificationQuestion(target: AnswerTarget): string {
  if (target.clarify_reason === "missing_object") return `Which kind of record do you mean? Tell me what to look at and I can check the ${target.state_concept ? target.state_concept + " " : ""}ones.`;
  if (target.clarify_reason === "missing_selection") return "Which of them do you want me to use? Tell me the one you mean and I'll go from there.";
  if (target.clarify_reason === "ambiguous_target") return "Which one do you mean? More than one thing fits, so I haven't picked one for you.";
  return "Which one do you mean? I can't tell what that refers to, so I haven't done anything.";
}
