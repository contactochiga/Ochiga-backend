import { normalizeUserTurn } from "../runtime/languageUnderstanding";

export function normalizeLanguage(rawText: unknown) {
  return normalizeUserTurn(rawText);
}
