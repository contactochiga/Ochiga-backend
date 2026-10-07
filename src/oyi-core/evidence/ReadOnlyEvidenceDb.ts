import { supabaseAdmin } from "../../supabase/supabaseClient";

// The database dependency handed to every planner/evidence-read source.
//
// It is STRUCTURALLY read-only: the only operation exposed on a table is `select`
// (whose filter chain cannot write). There is no insert/update/upsert/delete and no
// `rpc`, so a source cannot mutate state by construction, with nothing patched globally.
// Each call returns fresh frozen wrappers around the underlying client; no shared
// mutable state exists, so parallel reads cannot affect each other or any other request.
// The ordinary conversation/runtime client (`supabaseAdmin`) is never modified.
//
// Tests inject a controlled client via `readOnlyEvidenceDb(fake)` to simulate source
// failures, timeouts and truncation without a database.
export type EvidenceReadableTable = { readonly select: (columns?: string, options?: Record<string, unknown>) => any };
export type EvidenceDb = { readonly from: (table: string) => EvidenceReadableTable };
export type ReadOnlyEvidenceDb = Readonly<EvidenceDb> & { readonly kind: "read_only_evidence_db" };

type SelectableClient = { from: (table: string) => { select: (...args: any[]) => any } };

export function readOnlyEvidenceDb(client: SelectableClient = supabaseAdmin as unknown as SelectableClient): ReadOnlyEvidenceDb {
  return Object.freeze({
    kind: "read_only_evidence_db" as const,
    from: (table: string): EvidenceReadableTable => Object.freeze({
      select: (columns?: string, options?: Record<string, unknown>) => client.from(table).select(columns as string, options as any),
    }),
  });
}

// What a loader accepts: the read-only dependency, or the ordinary client (default) for
// existing non-planner callers. Loaders only ever call `.from(t).select(...)` on it.
export const ordinaryEvidenceDb = (): EvidenceDb => supabaseAdmin as unknown as EvidenceDb;
