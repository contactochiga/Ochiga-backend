import { analyse } from "../interpretation/semanticObjective";
import { contentTokens, type AnswerTarget } from "./answerTarget";

// IQ-8: the LEAD of a public (Osa) qualification answer, shaped by what the visitor asked. Everything comes from the caller's own supplied
// details and the existing completeness logic: no commitment, no guarantee, no internal criteria, and nothing is promised or booked.
export type PublicView = { known: Record<string, string>; missing: string[] | null; constraints: string[] }; // missing === null: no completeness model for this kind of inquiry
const COMMIT = new Set(["promise", "promises", "guarantee", "guarantees", "assure", "ensure", "commit", "commits", "sign", "approve", "accept", "enter", "pursue", "decide", "decision", "agree", "offer", "price", "return", "returns", "profit", "outcome"]);
const nice = (k: string) => k.replace(/_/g, " ");
const list = (xs: string[]) => xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
const knownText = (k: Record<string, string>) => Object.entries(k).map(([a, b]) => `${nice(a)}: ${b}`).join("; ");

export function publicLead(target: AnswerTarget, question: string, view: PublicView): string | null {
  if (!target.is_question) return null;
  const v = { ...view, missing: view.missing ?? [] }, modelled = view.missing !== null;
  const T = analyse(question).tokens;
  const commit = T.some(t => COMMIT.has(t));
  const asksSoFar = T.some(t => ["told", "have", "got", "know", "hold", "captured", "recorded"].includes(t)) && T.some(t => ["far", "now", "already", "so"].includes(t)) && (target.response_intent === "LIST" || target.response_intent === "DIRECT_ANSWER" || target.response_intent === "ASSESSMENT");
  switch (target.response_intent) {
    case "YES_NO_WITH_REASON": {
      if (commit) return "No — I can't promise or guarantee that, or commit Ochiga to anything; the team reviews each opportunity and decides.";
      if (T.some(t => ["enough", "sufficient", "ready"].includes(t)) && modelled) return v.missing.length ? `Not yet — for a first look I would still need: ${list(v.missing.map(nice))}.` : "Yes — that is everything we typically need to take a first look.";
      return null;
    }
    case "LIST": case "STATUS": case "ASSESSMENT": case "DIRECT_ANSWER": {
      if (asksSoFar) return Object.keys(v.known).length ? `So far you have told me: ${knownText(v.known)}.` : "You haven't given me any opportunity details yet.";
      if ((T.includes("need") || T.includes("missing") || T.includes("still") || T.includes("require")) && modelled) return v.missing.length ? `What I still need from you: ${list(v.missing.map(nice))}.` : "I don't need anything further for a first look.";
      return null;
    }
    case "RANKING": return modelled && v.missing.length ? `The most important thing I still need is ${nice(v.missing[0])}.` : null;
    case "ADVICE": case "NEXT_STEP": {
      if (commit) return "I can't commit Ochiga or advise you to sign anything; that is for you and the team after a proper review.";
      return modelled && v.missing.length ? `The first thing that would help is ${list(v.missing.slice(0, 2).map(nice))}.` : null;
    }
    case "COMPARISON": {
      if (T.includes("versus") || (T.includes("know") && T.some(t => ["check", "need", "missing", "unknown"].includes(t)))) return `What I know: ${Object.keys(v.known).length ? knownText(v.known) : "very little so far"}. What still needs checking: ${v.missing.length ? list(v.missing.map(nice)) : "nothing further for a first look"}.`;
      const sides = target.compare_terms.map(g => g.join(" ")).filter(Boolean);
      const named = sides.length === 2 ? `${sides[0]} or ${sides[1]}` : "those";
      if (T.includes("approach") || T.includes("different")) return `I can't say yet whether the approach would differ: that depends on what you want from the property${v.missing.length ? ` and on ${list(v.missing.slice(0, 2).map(nice))}, which I don't have` : ""}.`;
      return `I can't say which of ${named} suits you better yet: that depends on what you want from the property${v.missing.length ? ` and on ${list(v.missing.slice(0, 2).map(nice))}, which I don't have` : ""}.`;
    }
    case "LIMITATION": return null;
    default: return null;
  }
}
