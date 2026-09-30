// Shared by OfficeCorporateCapabilityModules.ts and
// PublicOpportunityCapabilityModule.ts -- extracted so the two can both
// use the same governed-knowledge-lookup-with-fallback pattern without a
// circular import between them.
import { getKnowledgeItemByCanonicalKey } from "../domains/knowledge/knowledgeRetrieval";

const CORPORATE_ANSWER_ACTOR = { agentRole: "oma" as const, audienceScope: "PUBLIC" as const };

export async function canonicalCorporateAnswer(canonicalKey: string, fallback: string): Promise<string> {
  try {
    const item = await getKnowledgeItemByCanonicalKey(canonicalKey, CORPORATE_ANSWER_ACTOR);
    return item?.content || fallback;
  } catch {
    return fallback;
  }
}
