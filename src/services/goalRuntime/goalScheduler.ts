// Oyi Autonomous Work Runtime -- scheduler tick (Part C). Mirrors
// scenes.ts's startAutomationRuntimeV2Scheduler/automationSchedulerTick/
// claimAndRunAutomation exactly: a 30s poll for due goals, a CAS claim
// so a concurrent tick or retry can never evaluate the same goal twice,
// then evaluateGoal() + persist(). This is the FALLBACK path -- the
// primary wake signal for reply-driven goals is the event-driven path
// in officeExport.ts's inbound webhook handler (wakeGoalsForThread).
import { logger } from "../../observability/logger";
import { goalRuntime } from "./GoalRuntime";
import { evaluateGoal } from "./goalEvaluator";
import type { GoalRecord } from "../../contracts/goal";

let goalScheduler: NodeJS.Timeout | null = null;
let goalSchedulerRunning = false;

export function startGoalRuntimeScheduler() {
  if (goalScheduler) return;
  logger.info("goal_scheduler_started", { tick_ms: 30_000 });
  goalScheduler = setInterval(() => {
    void goalSchedulerTick();
  }, 30_000);
  goalScheduler.unref?.();
  void goalSchedulerTick();
}

export function stopGoalRuntimeScheduler() {
  if (goalScheduler) clearInterval(goalScheduler);
  goalScheduler = null;
}

async function goalSchedulerTick() {
  if (goalSchedulerRunning) return;
  goalSchedulerRunning = true;
  const started = Date.now();
  try {
    const due = await goalRuntime.listDue(10);
    logger.info("goal_scheduler_tick", { due: due.length, duration_ms: Date.now() - started });
    for (const goal of due) {
      void claimAndEvaluateGoal(goal).catch((error) => logger.error("goal_evaluation_failed", { error, goal_id: goal.id, source: "scheduled" }));
    }
  } catch (error) {
    logger.error("goal_scheduler_tick_failed", { error });
  } finally {
    goalSchedulerRunning = false;
  }
}

// Exported so the event-driven wake path (officeExport.ts) can trigger
// an immediate evaluation of a goal that just received a reply, using
// the exact same CAS-claim + evaluate + persist path as the poll tick --
// no second execution mechanism.
export async function claimAndEvaluateGoal(goal: GoalRecord): Promise<void> {
  const claimed = await goalRuntime.claimForEvaluation(goal.id, goal.next_evaluation_at);
  if (!claimed) {
    // Someone else already claimed this tick (or it's no longer due) --
    // exactly the CAS-miss outcome scenes.ts's claimAndRunAutomation
    // relies on to prevent duplicate execution.
    logger.info("goal_evaluation_skipped", { goal_id: goal.id, reason: "claim_missed" });
    return;
  }
  logger.info("goal_evaluation_started", { goal_id: goal.id, status: claimed.status, current_step_index: claimed.current_step_index });
  const evaluated = await evaluateGoal(claimed);
  const persisted = await goalRuntime.persist(evaluated);
  logger.info("goal_evaluation_completed", {
    goal_id: goal.id,
    status: persisted.status,
    current_step_index: persisted.current_step_index,
    next_evaluation_at: persisted.next_evaluation_at,
    completion_reason: persisted.completion_reason,
  });
}
