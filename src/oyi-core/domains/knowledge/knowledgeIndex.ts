// Wave 9 Slice 1 -- builds the in-memory KnowledgeItem corpus by joining
// officeKnowledgeManifest.ts's classification metadata with real file
// content fetched from Office (officeKnowledgeBridge.ts). No database
// table -- see knowledgeContracts.ts's own Section 41 disclosure.
//
// Section 21 (versioning): id/canonicalKey are derived from the stable
// filename only, so identity survives editorial edits. `version` is a short
// content hash that changes on every edit -- this is what actually gives
// Section 21's "identity survives, revision changes" behavior, verified by
// the functional smoke (editing a file's content changes version, not id).
import { createHash } from "node:crypto";
import type { KnowledgeItem } from "./knowledgeContracts";
import { OFFICE_KNOWLEDGE_MANIFEST, manifestEntryFor } from "./officeKnowledgeManifest";
import { fetchOfficeKnowledgeFiles, type OfficeKnowledgeFile } from "./officeKnowledgeBridge";
import { BACKEND_INSTITUTIONAL_KNOWLEDGE_ITEMS } from "./backendInstitutionalKnowledge";

const SOURCE_REPO = "ochiga-office";

function shortHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function slugStem(file: string): string {
  return file.replace(/\.md$/i, "");
}

export function buildKnowledgeItem(file: OfficeKnowledgeFile): KnowledgeItem | null {
  const entry = manifestEntryFor(file.filename);
  if (!entry) return null; // Section 10 -- unclassified/excluded files never become retrievable items.
  const stem = slugStem(file.filename);
  return {
    id: `office-knowledge:${stem}`,
    canonicalKey: `office:${stem}`,
    title: entry.title,
    domain: entry.domain,
    authorityClass: entry.authorityClass,
    audience: entry.audience,
    agentVisibility: entry.agentVisibility,
    content: file.content,
    sourceRepo: SOURCE_REPO,
    sourceFile: `knowledge/${file.filename}`,
    version: shortHash(file.content),
    updatedAt: file.updatedAt,
    freshnessClass: entry.freshnessClass,
    claimBoundary: entry.claimBoundary,
    tags: entry.tags,
  };
}

export type KnowledgeIndexSnapshot = {
  items: KnowledgeItem[];
  builtAt: string;
  sourceOk: boolean;
  sourceReason: string | null;
  filesSeen: number;
  filesClassified: number;
};

// Section 40 -- built once per cache refresh (see knowledgeRetrieval.ts's
// TTL cache around this function), never re-fetched/re-parsed per query.
//
// Wave 9 Slice 2 -- merges TWO real sources, not one: Office's fetched
// pack, and Backend's own static institutional items
// (backendInstitutionalKnowledge.ts, converged this slice from
// OfficeCorporateCapabilityModules.ts's previously-hardcoded strings).
// The Backend-native items require no network call and are always
// present, even when Office is unreachable -- a genuine resilience
// improvement over the pre-Slice-2 state, where corporate.company/oyi/
// private/partnerships.read had no dependency on Office at all (now they
// depend on this in-memory index, which itself degrades gracefully, see
// getKnowledgeItemByCanonicalKey's own fallback contract in
// knowledgeRetrieval.ts).
export async function buildKnowledgeIndex(): Promise<KnowledgeIndexSnapshot> {
  const fetchResult = await fetchOfficeKnowledgeFiles();
  const backendItems = BACKEND_INSTITUTIONAL_KNOWLEDGE_ITEMS;
  if (!fetchResult.ok) {
    return { items: backendItems, builtAt: new Date().toISOString(), sourceOk: false, sourceReason: fetchResult.reason, filesSeen: 0, filesClassified: backendItems.length };
  }
  const officeItems: KnowledgeItem[] = [];
  for (const file of fetchResult.files) {
    const item = buildKnowledgeItem(file);
    if (item) officeItems.push(item);
  }
  return {
    items: [...officeItems, ...backendItems],
    builtAt: new Date().toISOString(),
    sourceOk: true,
    sourceReason: null,
    filesSeen: fetchResult.files.length,
    filesClassified: officeItems.length + backendItems.length,
  };
}

// Exposed for tests/observability -- the manifest's own declared file count,
// independent of any live fetch, so a smoke test can assert "every
// manifest-declared file either has real content or is honestly absent."
export function manifestFileCount(): number {
  return OFFICE_KNOWLEDGE_MANIFEST.length;
}
