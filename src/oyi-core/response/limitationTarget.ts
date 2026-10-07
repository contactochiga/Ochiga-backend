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
  if (target.response_intent === "CLARIFICATION") return "Which one do you mean? I can't tell what that refers to, so I have not done anything.";
  if (target.response_intent === "REFUSAL" && target.refusal_kind === "authority") return "I can't do that: I won't ignore or bypass privacy, permission or authority boundaries, whatever role is claimed.";
  if (target.response_intent === "REFUSAL") return "I can't say who is responsible: attributing a problem to a person is not something the evidence supports, and I won't guess or name anyone.";
  const asked = question.replace(/\s+/g, " ").trim().slice(0, 120);
  const lead = target.response_intent === "YES_NO_WITH_REASON" || target.response_intent === "ACTION_RESULT" ? "I can't tell" : "I can't answer that";
  return `${lead}: there is no enabled evidence source on this surface that could answer “${asked}” yet, so I would only be guessing.`;
}
