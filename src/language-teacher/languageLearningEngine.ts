import type { LanguageTeacherResult } from "./providerRegistry";

export type PhraseMemoryRecord = {
  phrase: string;
  normalized_phrase: string;
  domain: string;
  intent: string;
  confidence: number;
  usage_count: number;
  success_count: number;
  status: "candidate" | "approved" | "rejected";
};

export type PromotionPolicy = {
  min_usage_count: number;
  min_success_count: number;
  min_confidence: number;
  min_success_rate: number;
};

export const DEFAULT_PROMOTION_POLICY: PromotionPolicy = {
  min_usage_count: Number(process.env.LANGUAGE_TEACHER_PROMOTION_USAGE || 3),
  min_success_count: Number(process.env.LANGUAGE_TEACHER_PROMOTION_SUCCESS || 3),
  min_confidence: Number(process.env.LANGUAGE_TEACHER_PROMOTION_CONFIDENCE || 0.82),
  min_success_rate: Number(process.env.LANGUAGE_TEACHER_PROMOTION_SUCCESS_RATE || 0.75),
};

export function canPromotePhrase(record: PhraseMemoryRecord, policy: PromotionPolicy = DEFAULT_PROMOTION_POLICY) {
  if (record.status !== "candidate") return false;
  if (record.usage_count < policy.min_usage_count) return false;
  if (record.success_count < policy.min_success_count) return false;
  if (record.confidence < policy.min_confidence) return false;
  const rate = record.usage_count > 0 ? record.success_count / record.usage_count : 0;
  return rate >= policy.min_success_rate;
}

export function resultToCandidate(phrase: string, result: LanguageTeacherResult): PhraseMemoryRecord {
  return {
    phrase,
    normalized_phrase: result.normalized_phrase,
    domain: result.domain,
    intent: result.intent,
    confidence: result.confidence,
    usage_count: 1,
    success_count: result.confidence >= DEFAULT_PROMOTION_POLICY.min_confidence ? 1 : 0,
    status: "candidate",
  };
}

export function assertLanguageTeacherSafety(result: LanguageTeacherResult) {
  return {
    ok: Boolean(result.normalized_phrase && result.confidence >= 0 && result.confidence <= 1),
    may_execute: false,
    may_bypass_permissions: false,
    may_bypass_confirmation: false,
    reason: "Language Teacher only returns normalized intent suggestions.",
  };
}
