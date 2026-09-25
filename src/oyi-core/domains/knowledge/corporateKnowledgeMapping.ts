// Wave 9 Slice 1 -- the one place a RankedKnowledgeItem is narrowed down to
// the wire-level CorporateKnowledgeReference shape
// (contracts/corporateIntelligence.ts, discovered during this slice to
// already exist, pre-built, on both corporate request/response contracts --
// only ever fed an empty array until this slice). Kept separate from
// knowledgeRetrieval.ts itself so the canonical retrieval contract stays
// free of any one caller's wire format.
import type { CorporateKnowledgeReference } from "../../../contracts/corporateIntelligence";
import type { RankedKnowledgeItem } from "./knowledgeContracts";

// Full shape (id/title/excerpt/source) -- used for office_internal, which
// the contract already allows to see excerpts.
export function toCorporateKnowledgeReference(item: RankedKnowledgeItem): CorporateKnowledgeReference {
  return {
    id: item.id,
    title: item.title,
    excerpt: item.content.length > 400 ? `${item.content.slice(0, 400)}…` : item.content,
    source: item.sourceFile,
  };
}

// Section 20's own instruction: "does not necessarily mean exposing raw
// citations to every end user" -- the public corporate response's own
// existing contract type strips excerpt entirely (Array<{id,title,source}>,
// distinct from CorporateKnowledgeReference), so this mapping honors that
// pre-existing, narrower public shape rather than loosening it.
export function toPublicKnowledgeCitation(item: RankedKnowledgeItem): { id: string; title: string; source: string } {
  return { id: item.id, title: item.title, source: item.sourceFile };
}
