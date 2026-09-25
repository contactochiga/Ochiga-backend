// Wave 8 Slice 1 -- Device/State Outcome Evaluator.
//
// Generalizes outcomeEvaluation.ts's own proven pattern (compare an
// intended target against FRESH, independently re-queried evidence from
// the authority that already owns that fact -- never from the same
// transaction that dispatched the action) to the narrowest real device-
// state case: does Wave 6's own DeviceCurrentStateAuthority now show the
// device satisfying the target a Decision/Goal's device_action step
// selected.
//
// READ-ONLY with respect to the physical world: no provider call, no
// device command, no MQTT, no action dispatch happens anywhere in this
// file. The only write is a factual evaluation record persisted to the
// EXISTING, generic intelligence_feedback table (Wave 8 Slice 0's own
// audit found this table can honestly represent this evaluation without
// abusing any field -- no new table, no migration).
//
// This module does NOT implement learning. It never reads or writes
// oyi_learning_parameters, never changes recommendation ranking, never
// changes GoalRuntime's own completion semantics. It only teaches Oyi to
// truthfully answer one narrow question: did the authoritative real-world
// device state satisfy the target of this Decision/Goal.
import { supabaseAdmin } from "../../../supabase/supabaseClient";
import { logger } from "../../../observability/logger";
import { operationalMetrics } from "../../../observability/metrics";
import { resolveDeviceCurrentStates } from "./deviceCurrentStateAuthority";
import { deviceCurrentStateSelect } from "./deviceCurrentStateInput";
import type { FreshnessClassification } from "../../contracts/freshness";

// -----------------------------------------------------------------------
// Target semantics -- Section 4/23 of the task. device.on/device.off have
// a deterministic target (observed power = on/off respectively).
// device.toggle does NOT -- its outcome depends on the pre-action state,
// which this evaluator does not have access to and will not guess. A
// caller may supply an explicit target override for a toggle action if it
// genuinely knows the intended end state (e.g. a future producer that
// tracks pre-state itself); absent that, toggle is always "unsupported".
// -----------------------------------------------------------------------
export type DeviceOutcomeTarget = { power: boolean };
export type DeviceGoalActionId = "device.on" | "device.off" | "device.toggle";

export function targetForActionId(actionId: string, explicitTarget?: DeviceOutcomeTarget | null): DeviceOutcomeTarget | null {
  if (explicitTarget && typeof explicitTarget.power === "boolean") return explicitTarget;
  if (actionId === "device.on") return { power: true };
  if (actionId === "device.off") return { power: false };
  // device.toggle, or any unrecognized action id: never fabricate a target.
  return null;
}

// -----------------------------------------------------------------------
// Evaluation result taxonomy -- Section 9. Deliberately not a binary
// success/failure: "insufficient trustworthy evidence" is a genuinely
// different truthful answer from "authoritative state contradicts the
// target", and both are different again from "this action class has no
// deterministic target at all".
// -----------------------------------------------------------------------
export type DeviceOutcomeResult = "achieved" | "contradicted" | "unverified" | "unsupported";

export type DeviceOutcomeLineage = {
  deviceId: string;
  decisionId?: string | null;
  goalId?: string | null;
  executionId?: string | null;
  canonicalSignalKey?: string | null;
  estateId?: string | null;
  homeId?: string | null;
};

export type DeviceOutcomeEvaluationInput = {
  lineage: DeviceOutcomeLineage;
  actionId: DeviceGoalActionId;
  explicitTarget?: DeviceOutcomeTarget | null;
};

export type DeviceOutcomeEvaluation = {
  result: DeviceOutcomeResult;
  target: DeviceOutcomeTarget | null;
  observedPower: boolean | null;
  freshness: FreshnessClassification;
  availability: string | null;
  source: string | null;
  observedAt: string | null;
  lineage: DeviceOutcomeLineage;
  // The causal ceiling (Section 10), stated explicitly on every result so
  // no consumer of this evaluation can mistake it for a causation claim.
  causalNote: string;
  notes: string;
  persisted: boolean;
  feedbackId: string | null;
};

export const OBJECT_TYPE = "device_state_outcome";
export const FEEDBACK_TYPE = "device_state_outcome_evaluation";

const CAUSAL_NOTE =
  "This evaluation establishes only whether the target condition is currently satisfied per the latest authoritative observation. " +
  "Temporal correlation with the originating Decision/Goal/execution does not by itself establish that action caused this state.";

// A stable, non-random identity for de-duplicating the SAME evidence
// evaluated more than once (Section 11/20). Prefers real Decision/Goal/
// execution lineage over the device id alone -- an evaluation without any
// of those remains meaningful (it is still real evidence about the
// device), but callers should treat it as execution verification, not a
// Decision outcome (Section 6/16).
export function objectIdFor(lineage: DeviceOutcomeLineage, actionId: string): string {
  const lineageKey = lineage.decisionId || lineage.goalId || lineage.executionId || "no-lineage";
  return `device:${lineage.deviceId}:action:${actionId}:${lineageKey}`;
}

// Evidence identity: two evaluations against the exact same observation
// (same observedAt) are the exact same evidence -- re-running produces no
// duplicate factual feedback (Section 11/20). Two evaluations where
// nothing has ever been observed (no observedAt at all) also count as the
// same "no evidence yet" fact as long as the freshness classification
// itself hasn't changed (e.g. repeated "unknown, no observation" checks
// do not each get their own row; a transition to "stale" does, because
// that is new information -- time has passed and evidence still hasn't
// arrived).
function evidenceKeyFor(observedAt: string | null, freshness: string): string {
  return observedAt ? `at:${observedAt}` : `freshness:${freshness}`;
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

// Only "fresh" evidence is trustworthy enough to assert achieved/
// contradicted (Section 8). stale/expired/unknown/unobservable/
// provider_disconnected all honestly mean "not currently provable" --
// never a fabricated failure (Section 8/24).
function isTrustworthy(freshness: FreshnessClassification): boolean {
  return freshness === "fresh";
}

// Batched: ONE devices-table query and ONE current-state resolution for
// the entire input array (Section 30 -- no N+1 regardless of batch size),
// mirroring deviceEvidence.ts's own established fetch-then-resolve shape.
export async function evaluateDeviceStateOutcomes(inputs: DeviceOutcomeEvaluationInput[]): Promise<DeviceOutcomeEvaluation[]> {
  if (!inputs.length) return [];

  const evaluable: Array<{ input: DeviceOutcomeEvaluationInput; target: DeviceOutcomeTarget }> = [];
  const unsupported: DeviceOutcomeEvaluationInput[] = [];
  for (const input of inputs) {
    const target = targetForActionId(input.actionId, input.explicitTarget);
    if (target) evaluable.push({ input, target });
    else unsupported.push(input);
  }

  const results: DeviceOutcomeEvaluation[] = unsupported.map((input) => ({
    result: "unsupported",
    target: null,
    observedPower: null,
    freshness: "unknown",
    availability: null,
    source: null,
    observedAt: null,
    lineage: input.lineage,
    causalNote: CAUSAL_NOTE,
    notes: `Action "${input.actionId}" has no deterministic target without pre-action state -- never assumed on or off.`,
    persisted: false,
    feedbackId: null,
  }));

  if (!evaluable.length) return results;

  const deviceIds = Array.from(new Set(evaluable.map((e) => e.input.lineage.deviceId)));
  const { data: devices, error: deviceError } = await supabaseAdmin
    .from("devices")
    .select(deviceCurrentStateSelect())
    .in("id", deviceIds);
  if (deviceError) {
    logger.warn("oyi_device_outcome_devices_load_failed", { error: deviceError, device_ids: deviceIds });
  }
  const currentStateByDevice = await resolveDeviceCurrentStates(devices || []);

  const evaluated: Array<{ evaluation: DeviceOutcomeEvaluation; evidenceKey: string; objectId: string }> = [];
  for (const { input, target } of evaluable) {
    // resolveDeviceCurrentStates always returns an entry for every
    // requested device id (deviceCurrentStateAuthority.ts's own
    // unavailableState() fallback, freshness "unknown", source
    // "unavailable", reason "no_observation") -- current is never
    // actually null here, but this repository's own Wave 6 authority is
    // the single source of truth for what "no observation" honestly
    // means, so no separate sentinel is invented on top of it.
    const current = currentStateByDevice.get(input.lineage.deviceId) || null;
    const freshness: FreshnessClassification = current ? current.freshness : "unknown";
    const noObservation = !current || current.source === "unavailable";
    const observedAt = current?.observedAt || null;
    const observedPower = current ? (recordOf(recordOf(current.observedState).normalized_state).power as boolean | undefined) ?? null : null;

    let result: DeviceOutcomeResult;
    let notes: string;
    // "unknown"/"stale"/"expired"/"unobservable"/"provider_disconnected"
    // are all honestly insufficient -- never treated as a physical
    // failure (Section 8/24). Only real "fresh" evidence is trusted for
    // the achieved/contradicted split.
    if (!current || !isTrustworthy(freshness)) {
      result = "unverified";
      notes = noObservation
        ? "No current-state observation exists for this device -- outcome not currently provable."
        : `Latest observation is classified "${freshness}" -- not trustworthy enough to assert the target is or is not satisfied.`;
    } else if (typeof observedPower !== "boolean") {
      result = "unverified";
      notes = "Latest observation is fresh, but carries no power field -- outcome not currently provable from this evidence.";
    } else if (observedPower === target.power) {
      result = "achieved";
      notes = `Fresh authoritative state observed power=${observedPower}, matching target power=${target.power}.`;
    } else {
      result = "contradicted";
      notes = `Fresh authoritative state observed power=${observedPower}, contradicting target power=${target.power}.`;
    }

    const evidenceKey = evidenceKeyFor(observedAt, String(freshness));
    const objectId = objectIdFor(input.lineage, input.actionId);
    evaluated.push({
      evidenceKey,
      objectId,
      evaluation: {
        result,
        target,
        observedPower,
        freshness,
        availability: current?.availability ?? null,
        source: current?.source ?? null,
        observedAt,
        lineage: input.lineage,
        causalNote: CAUSAL_NOTE,
        notes,
        persisted: false,
        feedbackId: null,
      },
    });
  }

  // Batched idempotency check: ONE select across every distinct object_id
  // in this call, never one query per evaluation (Section 30).
  const objectIds = Array.from(new Set(evaluated.map((e) => e.objectId)));
  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from("intelligence_feedback")
    .select("id,object_id,outcome_metadata")
    .eq("object_type", OBJECT_TYPE)
    .eq("feedback_type", FEEDBACK_TYPE)
    .in("object_id", objectIds);
  if (existingError) {
    logger.warn("oyi_device_outcome_existing_lookup_failed", { error: existingError, object_ids: objectIds });
  }
  const existingByObjectId = new Map<string, Array<{ id: string; evidence_key: unknown }>>();
  for (const row of existingRows || []) {
    const list = existingByObjectId.get((row as any).object_id) || [];
    list.push({ id: (row as any).id, evidence_key: recordOf((row as any).outcome_metadata).evidence_key });
    existingByObjectId.set((row as any).object_id, list);
  }

  const toInsert: Array<Record<string, unknown>> = [];
  const insertIndexByEvaluated: number[] = [];
  evaluated.forEach((entry, index) => {
    const existing = (existingByObjectId.get(entry.objectId) || []).find((row) => row.evidence_key === entry.evidenceKey);
    if (existing) {
      entry.evaluation.persisted = true;
      entry.evaluation.feedbackId = existing.id;
      return;
    }
    insertIndexByEvaluated.push(index);
    toInsert.push({
      object_type: OBJECT_TYPE,
      object_id: entry.objectId,
      feedback_type: FEEDBACK_TYPE,
      actor_id: null,
      reason: entry.evaluation.causalNote,
      outcome_metadata: {
        evidence_key: entry.evidenceKey,
        result: entry.evaluation.result,
        target: entry.evaluation.target,
        observed_power: entry.evaluation.observedPower,
        freshness: entry.evaluation.freshness,
        availability: entry.evaluation.availability,
        source: entry.evaluation.source,
        observed_at: entry.evaluation.observedAt,
        lineage: entry.evaluation.lineage,
        notes: entry.evaluation.notes,
        evaluated_at: new Date().toISOString(),
      },
    });
  });

  if (toInsert.length) {
    const { data: inserted, error: insertError } = await supabaseAdmin.from("intelligence_feedback").insert(toInsert as any).select("id,object_id,outcome_metadata");
    if (insertError) {
      logger.warn("oyi_device_outcome_persist_failed", { error: insertError });
    } else {
      // Match inserted rows back to their evaluation by (object_id, evidence_key) --
      // insert() does not guarantee return order matches input order across all
      // Supabase client versions, so this is deliberately not positional.
      for (const row of inserted || []) {
        const evidenceKey = recordOf((row as any).outcome_metadata).evidence_key;
        const match = evaluated.find((e) => e.objectId === (row as any).object_id && e.evidenceKey === evidenceKey && !e.evaluation.persisted);
        if (match) {
          match.evaluation.persisted = true;
          match.evaluation.feedbackId = (row as any).id;
        }
      }
    }
  }

  for (const entry of evaluated) {
    operationalMetrics.increment("oyi_device_outcome_evaluation_total", { result: entry.evaluation.result, freshness: String(entry.evaluation.freshness) });
    results.push(entry.evaluation);
  }
  return results;
}

// Single-evaluation convenience wrapper for callers with exactly one
// device_action step to evaluate (e.g. goalEvaluator.ts's own producer).
export async function evaluateDeviceStateOutcome(input: DeviceOutcomeEvaluationInput): Promise<DeviceOutcomeEvaluation> {
  const [result] = await evaluateDeviceStateOutcomes([input]);
  return result;
}
