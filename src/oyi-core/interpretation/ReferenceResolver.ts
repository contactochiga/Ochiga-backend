import type { SemanticFrame } from "../contracts/semanticFrame";

export function resolveReferences(normalizedText: string): SemanticFrame["references"] {
  const refs: SemanticFrame["references"] = [];
  if (/\b(it|its|this|that|same one|same device|same channel)\b/i.test(normalizedText)) {
    refs.push({ phrase: RegExp.lastMatch || "it", kind: "pronoun", confidence: 0.8 });
  }
  if (/\b(other|second|first|channel\s*\d+|3gang|three gang)\b/i.test(normalizedText)) {
    refs.push({ phrase: RegExp.lastMatch || "candidate", kind: "candidate_reply", confidence: 0.72 });
  }
  return refs;
}
