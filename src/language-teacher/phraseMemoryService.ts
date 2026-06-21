import { supabaseAdmin } from "../supabase/supabaseClient";
import { canPromotePhrase, resultToCandidate, type PhraseMemoryRecord } from "./languageLearningEngine";
import type { LanguageTeacherResult } from "./providerRegistry";
import { cleanPhrase } from "./languageNormalization";

const TABLE = "oyi_language_phrase_memory";
const REJECT_CONFIDENCE = Number(process.env.LANGUAGE_TEACHER_REJECT_CONFIDENCE || 0.5);

type PhraseMemoryRow = PhraseMemoryRecord & { id?: string; provider?: string | null; last_seen_at?: string | null };

function rowToRecord(row: any): PhraseMemoryRow | null {
  if (!row) return null;
  return {
    id: row.id,
    phrase: row.phrase,
    normalized_phrase: row.normalized_phrase,
    domain: row.domain,
    intent: row.intent,
    confidence: Number(row.confidence || 0),
    usage_count: Number(row.usage_count || 0),
    success_count: Number(row.success_count || 0),
    status: row.status || "candidate",
    provider: row.provider || null,
    last_seen_at: row.last_seen_at || null,
  };
}

export async function findApprovedPhrase(phrase: string): Promise<PhraseMemoryRow | null> {
  const clean = cleanPhrase(phrase);
  if (!clean) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select("*")
      .eq("phrase_key", clean)
      .eq("status", "approved")
      .maybeSingle();
    if (error) return null;
    return rowToRecord(data);
  } catch {
    return null;
  }
}

export async function recordPhraseCandidate(phrase: string, result: LanguageTeacherResult): Promise<PhraseMemoryRow | null> {
  const phraseKey = cleanPhrase(phrase);
  if (!phraseKey) return null;
  const candidate = resultToCandidate(phrase, result);
  try {
    const { data: existing } = await supabaseAdmin
      .from(TABLE)
      .select("*")
      .eq("phrase_key", phraseKey)
      .maybeSingle();
    if (existing) {
      const next: PhraseMemoryRow = {
        ...rowToRecord(existing)!,
        confidence: Math.max(Number(existing.confidence || 0), result.confidence),
        usage_count: Number(existing.usage_count || 0) + 1,
        success_count: Number(existing.success_count || 0) + (result.confidence >= 0.82 ? 1 : 0),
      };
      const status = next.status === "rejected"
        ? "rejected"
        : canPromotePhrase(next)
          ? "approved"
          : result.confidence < REJECT_CONFIDENCE
            ? "rejected"
            : "candidate";
      const { data } = await supabaseAdmin
        .from(TABLE)
        .update({
          normalized_phrase: result.normalized_phrase,
          domain: result.domain,
          intent: result.intent,
          confidence: next.confidence,
          usage_count: next.usage_count,
          success_count: next.success_count,
          status,
          provider: result.provider,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select("*")
        .maybeSingle();
      return rowToRecord(data);
    }
    const { data } = await supabaseAdmin
      .from(TABLE)
      .insert({
        phrase: candidate.phrase,
        phrase_key: phraseKey,
        normalized_phrase: candidate.normalized_phrase,
        domain: candidate.domain,
        intent: candidate.intent,
        confidence: candidate.confidence,
        usage_count: candidate.usage_count,
        success_count: candidate.success_count,
        status: result.confidence < REJECT_CONFIDENCE ? "rejected" : candidate.status,
        provider: result.provider,
        last_seen_at: new Date().toISOString(),
      })
      .select("*")
      .maybeSingle();
    return rowToRecord(data);
  } catch {
    return null;
  }
}

export async function recordLanguageObservation(input: {
  phrase: string;
  result: LanguageTeacherResult;
  status?: PhraseMemoryRecord["status"] | null;
}) {
  try {
    await supabaseAdmin.from("oyi_language_teacher_observations").insert({
      phrase: input.phrase,
      normalized_phrase: input.result.normalized_phrase,
      domain: input.result.domain,
      intent: input.result.intent,
      confidence: input.result.confidence,
      provider: input.result.provider,
      event_type: input.status === "approved"
        ? "phrase_promoted"
        : input.status === "rejected"
          ? "phrase_rejected"
          : "phrase_learned",
    });
  } catch {
    // Observability must never block Oyi routing.
  }
}
