import { reconcileMaterialization } from '../oyi-core/persistence/materialization';
import { operationalMetrics } from '../observability/metrics';
let timer: NodeJS.Timeout|null=null, busy=false;
export function startCanonicalMaterializationWorker() {
 if(timer || process.env.CANONICAL_MATERIALIZATION_RECOVERY_ENABLED!=='true')return;
 const run=async()=>{if(busy)return;busy=true;try{const rows=await reconcileMaterialization(25);for(const row of rows)operationalMetrics.increment('canonical_materialization_attempts_total',{result:row.complete?'materialized':'retryable'});}catch{operationalMetrics.increment('canonical_materialization_worker_failures_total');}finally{busy=false;}};
 void run();timer=setInterval(run,30000);timer.unref();
}
export function stopCanonicalMaterializationWorker(){if(timer)clearInterval(timer);timer=null;}
