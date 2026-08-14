import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { logger } from "../../observability/logger";
import { operationalMetrics } from "../../observability/metrics";
import { runIntelligenceOrchestrator } from "../domains/intelligence/intelligenceOrchestrator";
import { evaluateOpenPredictions } from "../domains/intelligence/outcomeEvaluation";
import { runLearningProposalPass } from "../domains/intelligence/learningProposalPass";
import type { CanonicalConversationRequest } from "../contracts/canonicalConversation";
import type { IntelligenceRequestContract } from "../interpretation/conversationIntentRouting";

// Programme 4 Phase H — production invocation for the proactive intelligence
// logic Programme 3 built and documented as "built and tested, not wired to
// a cron/queue" (docs/architecture/OYI_PREDICTION_LEARNING_MODEL.md, "Not
// Completed In Programme 3"). This file adds the missing trigger only — it
// reuses runIntelligenceOrchestrator(proactive: true) and
// evaluateOpenPredictions(...) exactly as conversational capabilities do
// (see intelligenceCapabilities.ts), and reuses this repo's existing BullMQ
// worker infrastructure (src/workers/automationWorker.ts's pattern) rather
// than introducing a second scheduler mechanism.
//
// Permanent rules enforced here, not just documented:
// - no physical execution: only read/evaluate functions are called, never
//   ActionService/WorkflowService/execute.
// - no automatic learning promotion: this file never imports or calls
//   promoteLearningParameter.
// - bounded batch size, per-run delivery cap, tenant/home isolation,
//   idempotency and failure isolation are enforced per home in the loop
//   below; per-home delivery is additionally capped inside
//   runProactiveDelivery itself (MAX_DELIVERIES_PER_RUN = 5).
// - disabled by default: OYI_PROACTIVE_SCHEDULER_ENABLED must be explicitly
//   set to "true" for the repeatable job to be scheduled at all.

const QUEUE_NAME = "oyi-proactive-intelligence";
const REPEATABLE_JOB_NAME = "run-proactive-intelligence-tick";
const LEARNING_PROPOSAL_JOB_NAME = "run-learning-proposal-pass";

const ENABLED = String(process.env.OYI_PROACTIVE_SCHEDULER_ENABLED || "").toLowerCase() === "true";
const INTERVAL_MS = Number(process.env.OYI_PROACTIVE_SCHEDULER_INTERVAL_MS || 15 * 60 * 1000);
const BATCH_SIZE = Math.max(1, Number(process.env.OYI_PROACTIVE_SCHEDULER_BATCH_SIZE || 25));
const MAX_DELIVERIES_PER_RUN = Math.max(1, Number(process.env.OYI_PROACTIVE_SCHEDULER_MAX_DELIVERIES_PER_RUN || 50));

// Independent flag/interval — Programme 4 Phase I. A deployment may want
// proactive delivery on and learning proposals off (or vice versa), so
// these are never coupled to OYI_PROACTIVE_SCHEDULER_ENABLED. Learning
// proposals aggregate global evidence and are only meaningful to
// recompute infrequently (default: once a day), unlike the per-home
// proactive tick.
const LEARNING_PROPOSAL_ENABLED = String(process.env.OYI_LEARNING_PROPOSAL_ENABLED || "").toLowerCase() === "true";
const LEARNING_PROPOSAL_INTERVAL_MS = Number(process.env.OYI_LEARNING_PROPOSAL_INTERVAL_MS || 24 * 60 * 60 * 1000);

let connection: IORedis | null = null;
function redisConnection() {
  if (!connection) {
    connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", { maxRetriesPerRequest: null });
  }
  return connection;
}

// In-process, best-effort — prevents a slow tick from overlapping with the
// next scheduled tick within the same worker process. Not a distributed
// lock; if multiple worker processes run this queue, BullMQ's own
// single-consumer-per-job semantics (a repeatable job produces one queued
// job per tick, picked up by exactly one worker) is the real idempotency
// guarantee. This flag only protects against a single process double-firing
// on its own repeat schedule if a run takes longer than INTERVAL_MS.
let runInProgress = false;

// Keyset pagination cursor with wraparound so every home gets evaluated in
// rotation across ticks, instead of unboundedly processing every home every
// tick (bounded batch size) or always favoring the same first N homes.
let cursorHomeId: string | null = null;

async function nextHomeBatch(limit: number): Promise<Array<{ id: string; estate_id: string | null }>> {
  let query = supabaseAdmin.from("homes").select("id, estate_id").order("id", { ascending: true }).limit(limit);
  if (cursorHomeId) query = query.gt("id", cursorHomeId);
  const { data, error } = await query;
  if (error) {
    logger.warn("oyi_proactive_scheduler_home_batch_failed", { error: error.message, cursor: cursorHomeId });
    return [];
  }
  let rows = data || [];
  if (rows.length < limit) {
    // Wrapped past the end — fill the rest of the batch from the start.
    const remaining = limit - rows.length;
    const { data: wrapped, error: wrapError } = await supabaseAdmin
      .from("homes")
      .select("id, estate_id")
      .order("id", { ascending: true })
      .limit(remaining);
    if (wrapError) {
      logger.warn("oyi_proactive_scheduler_home_batch_wrap_failed", { error: wrapError.message });
    } else {
      const seen = new Set(rows.map((row) => row.id));
      rows = [...rows, ...(wrapped || []).filter((row) => !seen.has(row.id))];
    }
  }
  cursorHomeId = rows.length ? rows[rows.length - 1].id : null;
  return rows as Array<{ id: string; estate_id: string | null }>;
}

function minimalContractFor(homeId: string | null, estateId: string | null): { input: CanonicalConversationRequest; contract: IntelligenceRequestContract } {
  const input: CanonicalConversationRequest = { message: "", surface: "consumer", estate_id: estateId, home_id: homeId } as CanonicalConversationRequest;
  const contract: IntelligenceRequestContract = {
    conversation_request_id: "proactive-intelligence-scheduler",
    thread_id: null,
    surface: "consumer",
    operation_class: "read",
    intent: "evidence",
    scope_mode: "home_scope",
    temporal_scope: { mode: "current", from: null, to: null },
    target: { object_type: null, canonical_id: null, parent_id: null, channel_code: null, label: null },
    mutation: { requested: false, confirmed: false, command: null, desired_state: null, risk_class: "read" },
    evidence_requirements: { current_state: true, recent_events: true, execution_history: true, audit_history: false, relationships: false, permissions: true, provider_state: false, financial_ledger: false, access_records: false },
    answer_builder: null,
    report_builder: null,
    truth_policy: "read_only_no_execution",
    confidence: 0.8,
  } as unknown as IntelligenceRequestContract;
  return { input, contract };
}

type TickSummary = {
  homes_processed: number;
  homes_failed: number;
  anomalies: number;
  predictions: number;
  forecasts: number;
  recommendations: number;
  deliveries_attempted: number;
  deliveries_sent: number;
  deliveries_suppressed: number;
  outcomes_evaluated: number;
  duration_ms: number;
};

async function runOneHome(home: { id: string; estate_id: string | null }, deliveryBudgetRemaining: number, summary: TickSummary) {
  const { input, contract } = minimalContractFor(home.id, home.estate_id);
  const scope = { estate_id: home.estate_id, home_id: home.id, room_id: null };
  const allowProactive = deliveryBudgetRemaining > 0;

  const orchestratorResult = await runIntelligenceOrchestrator({
    input,
    oisContext: null,
    contract,
    scope,
    actor: null,
    persist: true,
    proactive: allowProactive,
  });

  summary.anomalies += orchestratorResult.anomalies.length;
  summary.predictions += orchestratorResult.predictions.length;
  summary.forecasts += orchestratorResult.forecasts.length;
  summary.recommendations += orchestratorResult.recommendations.length;
  for (const delivery of orchestratorResult.proactive_deliveries) {
    summary.deliveries_attempted += 1;
    if (delivery.delivered) summary.deliveries_sent += 1;
    else summary.deliveries_suppressed += 1;
  }

  const outcome = await evaluateOpenPredictions({ estate_id: home.estate_id, home_id: home.id });
  summary.outcomes_evaluated += outcome.evaluated.length;

  return orchestratorResult.proactive_deliveries.filter((delivery) => delivery.delivered).length;
}

export async function runProactiveIntelligenceTick(): Promise<TickSummary> {
  const startedAt = Date.now();
  const summary: TickSummary = {
    homes_processed: 0,
    homes_failed: 0,
    anomalies: 0,
    predictions: 0,
    forecasts: 0,
    recommendations: 0,
    deliveries_attempted: 0,
    deliveries_sent: 0,
    deliveries_suppressed: 0,
    outcomes_evaluated: 0,
    duration_ms: 0,
  };

  if (runInProgress) {
    logger.warn("oyi_proactive_scheduler_tick_skipped_overlap", {});
    operationalMetrics.increment("oyi_proactive_scheduler_ticks_total", { outcome: "skipped_overlap" });
    return summary;
  }
  runInProgress = true;
  try {
    const homes = await nextHomeBatch(BATCH_SIZE);
    let deliveryBudgetRemaining = MAX_DELIVERIES_PER_RUN;
    for (const home of homes) {
      try {
        const delivered = await runOneHome(home, deliveryBudgetRemaining, summary);
        deliveryBudgetRemaining = Math.max(0, deliveryBudgetRemaining - delivered);
        summary.homes_processed += 1;
      } catch (error) {
        summary.homes_failed += 1;
        logger.warn("oyi_proactive_scheduler_home_failed", {
          home_id: home.id,
          estate_id: home.estate_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    runInProgress = false;
  }

  summary.duration_ms = Date.now() - startedAt;
  operationalMetrics.increment("oyi_proactive_scheduler_ticks_total", { outcome: "completed" });
  operationalMetrics.increment("oyi_proactive_scheduler_homes_processed_total", {}, summary.homes_processed);
  operationalMetrics.increment("oyi_proactive_scheduler_homes_failed_total", {}, summary.homes_failed);
  operationalMetrics.increment("oyi_proactive_scheduler_deliveries_sent_total", {}, summary.deliveries_sent);
  operationalMetrics.increment("oyi_proactive_scheduler_deliveries_suppressed_total", {}, summary.deliveries_suppressed);
  operationalMetrics.increment("oyi_proactive_scheduler_outcomes_evaluated_total", {}, summary.outcomes_evaluated);
  operationalMetrics.observe("oyi_proactive_scheduler_tick_duration_ms", summary.duration_ms);
  logger.info("oyi_proactive_scheduler_tick_completed", summary as unknown as Record<string, unknown>);
  return summary;
}

export const proactiveIntelligenceQueue = new Queue(QUEUE_NAME, { connection: redisConnection() });

// Learning-proposal pass errors are isolated from the proactive-tick job —
// a failure here must never be reported against, or block, the tick job.
async function runLearningProposalJob() {
  try {
    const result = await runLearningProposalPass();
    operationalMetrics.increment("oyi_learning_proposal_pass_runs_total", { outcome: "completed" });
    operationalMetrics.increment("oyi_learning_proposal_proposed_total", {}, result.outcomes.filter((o) => o.status === "proposed").length);
    operationalMetrics.increment("oyi_learning_proposal_insufficient_evidence_total", {}, result.outcomes.filter((o) => o.status === "insufficient_evidence").length);
  } catch (error) {
    operationalMetrics.increment("oyi_learning_proposal_pass_runs_total", { outcome: "failed" });
    logger.warn("oyi_learning_proposal_pass_failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

export async function startProactiveIntelligenceScheduler() {
  if (!ENABLED && !LEARNING_PROPOSAL_ENABLED) {
    logger.info("oyi_proactive_scheduler_disabled", { reason: "neither OYI_PROACTIVE_SCHEDULER_ENABLED nor OYI_LEARNING_PROPOSAL_ENABLED is \"true\"" });
    return null;
  }

  if (ENABLED) {
    await proactiveIntelligenceQueue.add(
      REPEATABLE_JOB_NAME,
      {},
      { jobId: REPEATABLE_JOB_NAME, repeat: { every: INTERVAL_MS }, removeOnComplete: true, removeOnFail: true }
    );
  } else {
    logger.info("oyi_proactive_scheduler_tick_disabled", { reason: "OYI_PROACTIVE_SCHEDULER_ENABLED is not \"true\"" });
  }

  if (LEARNING_PROPOSAL_ENABLED) {
    await proactiveIntelligenceQueue.add(
      LEARNING_PROPOSAL_JOB_NAME,
      {},
      { jobId: LEARNING_PROPOSAL_JOB_NAME, repeat: { every: LEARNING_PROPOSAL_INTERVAL_MS }, removeOnComplete: true, removeOnFail: true }
    );
  } else {
    logger.info("oyi_learning_proposal_disabled", { reason: "OYI_LEARNING_PROPOSAL_ENABLED is not \"true\"" });
  }

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      if (job.name === LEARNING_PROPOSAL_JOB_NAME) await runLearningProposalJob();
      else await runProactiveIntelligenceTick();
    },
    { connection: redisConnection() }
  );
  worker.on("failed", (job, error) => {
    logger.error("oyi_proactive_scheduler_job_failed", { job_id: job?.id, job_name: job?.name, error: error instanceof Error ? error.message : String(error) });
  });
  logger.info("oyi_proactive_scheduler_started", {
    proactive_tick_enabled: ENABLED,
    interval_ms: INTERVAL_MS,
    batch_size: BATCH_SIZE,
    max_deliveries_per_run: MAX_DELIVERIES_PER_RUN,
    learning_proposal_enabled: LEARNING_PROPOSAL_ENABLED,
    learning_proposal_interval_ms: LEARNING_PROPOSAL_INTERVAL_MS,
  });
  return worker;
}
