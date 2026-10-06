import { AsyncLocalStorage } from "node:async_hooks";

// Planner-eligible evidence collection must be PURE READ: gathering evidence for
// an assessment can never create durable intelligence state (goals, decisions,
// recommendations, awareness, workflows, communications, action proposals, memory,
// learning) or mutate a device. This module is the reusable enforcement layer.
//
// Runtime layer: inside runPureRead(), every Supabase table write verb and RPC is
// refused and recorded. Every durable Oyi state write goes through the database, so
// this closes goals/decisions/recommendations/awareness/workflows/communications/
// proposals/memory/learning and any persisted device-command ledger by construction.
// Static layer: assertPureReadModule() rejects a certified collector module that
// imports a writer/dispatcher module (see PURE_READ_FORBIDDEN_IMPORTS).

const store = new AsyncLocalStorage<{ violations: string[] }>();
const GUARDED = Symbol.for("oyi.pureRead.guarded");
const WRITE_VERBS = new Set(["insert", "update", "upsert", "delete"]);

export class PureReadViolation extends Error {
  constructor(readonly operation: string) {
    super(`PURE_READ_VIOLATION: ${operation}`);
    this.name = "PureReadViolation";
  }
}

export const inPureRead = () => Boolean(store.getStore());

function refuse(operation: string): never {
  store.getStore()?.violations.push(operation);
  throw new PureReadViolation(operation);
}

type AnyClient = { from: (table: string) => any; rpc?: (...args: any[]) => any } & Record<string, any>;

/**
 * Idempotently wrap a client's `from`/`rpc`. Safe to call on every read: a client
 * whose `from` was replaced (tests, fault injection) is re-wrapped, while an
 * already-guarded function is left alone. Outside runPureRead() behaviour is unchanged.
 */
export function guardSupabaseClient(db: AnyClient) {
  if (!(db.from as any)[GUARDED]) {
    const original = db.from.bind(db);
    const guarded = (table: string) => {
      const builder = original(table);
      return new Proxy(builder, {
        get(target, prop, receiver) {
          if (typeof prop === "string" && WRITE_VERBS.has(prop)) {
            return (...args: unknown[]) => {
              if (inPureRead()) refuse(`${table}.${prop}`);
              return (target as any)[prop](...args);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });
    };
    (guarded as any)[GUARDED] = true;
    db.from = guarded as any;
  }
  if (typeof db.rpc === "function" && !(db.rpc as any)[GUARDED]) {
    const originalRpc = db.rpc.bind(db);
    const guardedRpc = (...args: any[]) => { if (inPureRead()) refuse(`rpc.${String(args[0])}`); return originalRpc(...args); };
    (guardedRpc as any)[GUARDED] = true;
    db.rpc = guardedRpc as any;
  }
}

/** Run one read with the guard active; returns violations observed (also thrown). */
export async function runPureRead<T>(db: AnyClient, read: () => Promise<T>): Promise<{ value: T; violations: string[] } | { value: null; violations: string[]; error: unknown }> {
  guardSupabaseClient(db);
  const scope = { violations: [] as string[] };
  try {
    const value = await store.run(scope, read);
    return { value, violations: scope.violations };
  } catch (error) {
    return { value: null, violations: scope.violations, error };
  }
}

// Modules that create durable state, enqueue communications or dispatch device
// commands. A planner-eligible collector module must not import any of them.
export const PURE_READ_FORBIDDEN_IMPORTS: RegExp[] = [
  /goalRuntime|goalProposal|goalPersistence|goalOutcome/i,
  /decisionPersistence|decisionRuntime|decisionLedger/i,
  /predictionPersistence|recommendationPersistence|persistPrediction|persistForecast/i,
  /awarenessWriter|awarenessPersistence|writeAwareness/i,
  /workflowRuntime|workflowPersistence|workflowCreate/i,
  /communicationProposal|communicationDispatch|notificationDispatch|officeHandoffBridge|emailService|smsService/i,
  /actionProposal|pendingActionProposal|deviceActionAdapter|deviceCommand|executeDeviceAction/i,
  /memoryWriter|memoryPersistence|writeMemory/i,
  /learningPromotion|promoteLearning|learningPersistence/i,
];

// Allowlist for evidence-source adapter modules (evidence/sources/*): readers, outcome
// helpers, contracts and pure resolvers only. A new import must be reviewed and added
// here deliberately; a denylist alone cannot anticipate a new writer.
export const PURE_READ_ALLOWED_IMPORTS: RegExp[] = [
  /^(?:\.\.?\/)+contracts\//,
  /^\.\.\/EvidenceEnvelope$/, /^\.\.\/EvidenceReadOutcome$/, /^\.\/evidenceFromFact$/,
  /^(?:\.\.\/)+domains\/devices\/deviceEvidence$/,
  /^(?:\.\.\/)+domains\/contributorSummary$/,
  /^(?:\.\.\/)+runtime\/canonicalTurnResolution$/, /^(?:\.\.\/)+runtime\/languageUnderstanding$/,
  /^(?:\.\.\/)+supabase\/supabaseClient$/,
  /^(?:\.\.\/)+modules\/cameras\/cameraAccess\.policy$/,
  /^(?:\.\.\/)+modules\/cameras\/cameraCurrentStateAuthority$/,
  /^(?:\.\.\/)+modules\/cameras\/cameraCurrentStatePresentation$/,
  /^(?:\.\.\/)+capabilities\/corporateKnowledgeAnswer$/,
  /^(?:\.\.\/)+context\/publicOpportunityObjective$/,
];

/** Import specifiers that are forbidden or not on the allowlist. Empty means the module is admissible. */
export function pureReadImportViolations(source: string): string[] {
  const imports = [...source.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm)].map(m => m[1]);
  return imports.filter(spec => PURE_READ_FORBIDDEN_IMPORTS.some(re => re.test(spec)) || !PURE_READ_ALLOWED_IMPORTS.some(re => re.test(spec)));
}
