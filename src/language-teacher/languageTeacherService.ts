import { createProviderRegistry } from "./providerRegistry";
import type { LanguageTeacherResult } from "./providerRegistry";
import { LocalAdapter, normalizeLanguageTeacherResult } from "./languageNormalization";
import { assertLanguageTeacherSafety } from "./languageLearningEngine";
import { findApprovedPhrase, recordLanguageObservation, recordPhraseCandidate } from "./phraseMemoryService";

const registry = createProviderRegistry(new LocalAdapter());

export type LanguageTeacherInterpretInput = {
  phrase: string;
  surface?: string | null;
  locale?: string | null;
  context?: Record<string, unknown>;
  provider?: string | null;
};

export async function interpretWithLanguageTeacher(input: LanguageTeacherInterpretInput): Promise<LanguageTeacherResult | null> {
  const phrase = String(input.phrase || "").trim();
  if (!phrase) return null;

  const approved = await findApprovedPhrase(phrase);
  if (approved) {
    return {
      domain: approved.domain as LanguageTeacherResult["domain"],
      intent: approved.intent as LanguageTeacherResult["intent"],
      entities: [],
      confidence: approved.confidence,
      normalized_phrase: approved.normalized_phrase,
      provider: "local",
    };
  }

  const provider = registry.get(input.provider);
  const interpreted = normalizeLanguageTeacherResult(await provider.interpret(input));
  if (!interpreted) return null;
  const safety = assertLanguageTeacherSafety(interpreted);
  if (!safety.ok || safety.may_execute || safety.may_bypass_confirmation || safety.may_bypass_permissions) return null;

  const memory = await recordPhraseCandidate(phrase, interpreted);
  await recordLanguageObservation({ phrase, result: interpreted, status: memory?.status });
  return interpreted;
}

export function shouldAskLanguageTeacher(input: { domain?: unknown; intent?: string | null; phrase?: string | null }) {
  const phrase = String(input.phrase || "").trim();
  if (!phrase || phrase.length < 3) return false;
  if (input.domain) return false;
  return !input.intent || input.intent === "general_help";
}

export function languageTeacherResultToMessage(result: LanguageTeacherResult | null, fallback: string) {
  return result?.normalized_phrase || fallback;
}
