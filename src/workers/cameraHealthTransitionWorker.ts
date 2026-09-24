import { evaluateCameraTransitions, deliverCameraTransitions } from "../modules/cameras/cameraHealthTransition.service";
import { operationalMetrics } from "../observability/metrics";
let timer: NodeJS.Timeout | null = null;
let busy = false, cursor = "";
export function startCameraHealthTransitionWorker() {
  if (timer || process.env.CAMERA_HEALTH_TRANSITIONS_ENABLED === "false") return;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      const result = await evaluateCameraTransitions(cursor,100);
      cursor = result.cursor;
    } catch { operationalMetrics.increment("camera_transition_worker_failures_total"); }
    // Accepted obligations must still be delivered if evaluation is unavailable.
    try { await deliverCameraTransitions(25); }
    catch { operationalMetrics.increment("camera_transition_worker_failures_total"); }
    finally { busy = false; }
  };
  void run();
  timer = setInterval(run,30000); timer.unref();
}
export function stopCameraHealthTransitionWorker() { if (timer) clearInterval(timer); timer=null; }
