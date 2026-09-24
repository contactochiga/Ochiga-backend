import { createHash } from 'node:crypto';
import { supabaseAdmin } from '../../supabase/supabaseClient';
import { operationalMetrics } from '../../observability/metrics';
import { homeIdFromSignal, resolveIntelligencePolicy } from '../policy/intelligencePolicyResolver';
import { correlateIncident } from '../runtime/incidentCorrelation';
import type { RuntimeBundle } from '../service';
import type { SignalRuntimeReceipt } from '../runtime/universalSignalRuntime';

export const canonicalSignalKey = (s: any) => [s.provider || s.source,s.providerEventId || s.id,s.domain,s.entity.id || s.entity.name || 'unknown',s.estateId || 'global',homeIdFromSignal(s) || 'no-home'].join(':');
function uuid(key: string) { const h=createHash('sha256').update(key).digest('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; }
export type MaterializationAck = { signalPersisted: boolean; canonicalSignalId: string|null; canonicalSignalKey: string; materializationState: string; materializationComplete: boolean; duplicate?: boolean };
// Domain-generated insight/recommendation IDs are reusable across signals. Scope persistence
// identities after reasoning, without changing scores, evidence or correlation semantics.
export function scopeMaterializationIdentities(bundle: RuntimeBundle, signal: any) {
 const key=canonicalSignalKey(signal), mappings=new Map<string,string>();
 for(const [kind,items] of [['awareness',bundle.awareness],['insight',bundle.insights],['recommendation',bundle.recommendations],['plan',bundle.automationPlans]] as const)
  for(const item of items)mappings.set(item.id,`${kind}:${uuid(`${key}:${kind}:${item.id}`)}`);
 for(const item of [...bundle.awareness,...bundle.insights,...bundle.recommendations,...bundle.automationPlans])item.id=mappings.get(item.id)!;
 for(const item of [...bundle.insights,...bundle.recommendations,...bundle.automationPlans])item.relatedAwareness=item.relatedAwareness.map(id=>mappings.get(id)||id);
 for(const item of [...bundle.recommendations,...bundle.automationPlans])item.relatedInsights=item.relatedInsights.map(id=>mappings.get(id)||id);
 for(const item of bundle.automationPlans){item.relatedRecommendations=item.relatedRecommendations.map(id=>mappings.get(id)||id);item.sourceRecommendationId=mappings.get(item.sourceRecommendationId)||item.sourceRecommendationId;}
}
export function materializationAck(row: any, key: string): MaterializationAck { const state=row?.state || row?.materialization?.state || 'legacy_unverified'; return {signalPersisted:!!(row?.signal_id || row?.id),canonicalSignalId:row?.signal_id || row?.id || null,canonicalSignalKey:key,materializationState:state,materializationComplete:state==='materialized',duplicate:row?.duplicate}; }
export async function lookupMaterialization(signal: any) {
 const key=canonicalSignalKey(signal); const {data,error}=await supabaseAdmin.from('operational_signals').select('id,materialization').eq('canonical_signal_key',key).maybeSingle();
 if(error) throw error; return data?materializationAck(data,key):null;
}
export function prepareMaterialization(bundle: RuntimeBundle, receipt: SignalRuntimeReceipt) {
 const s=receipt.signal, policy=resolveIntelligencePolicy(s),home=homeIdFromSignal(s),key=canonicalSignalKey(s);
 const at=receipt.receivedAt,c=correlateIncident(s,bundle.awareness[0]||null);
 const id=(kind:string,k:string)=>uuid(`${key}:${kind}:${k}`);
 const incident=c?{incident_key:c.incidentKey,incident_type:c.incidentType,domain:c.domain,title:c.title,scope:c.scope,privacy_class:policy.privacyClass,status:c.status,severity:c.severity,confidence:c.confidence,owner_type:s.actor.type||s.initiatorType||'system',owner_id:s.actor.id||s.initiatorId||null,first_seen_at:s.timestamp,last_seen_at:s.timestamp,resolved_at:c.status==='resolved'?s.timestamp:null,current_summary:c.summary,affected_entities:c.affectedEntities,evidence:c.evidence,estate_id:s.estateId,home_id:home}:null;
 const rows={
 awareness:bundle.awareness.map(a=>({id:id('awareness',a.id),awareness_key:a.id,estate_id:s.estateId||null,home_id:home,audience:policy.privacyClass,status:c?.suppressChildAwareness?'suppressed':c?.status==='resolved'?'resolved':'open',title:a.title,summary:a.summary,reason:a.reason,impact:a.impact,urgency:a.urgency,owner:a.owner,recommended_action:a.recommended_action,verification:a.verification,confidence:a.confidence,related_signals:a.related_signals,related_executions:a.related_executions,generated_at:a.generated_at,updated_at:at,score_breakdown:{},payload:a})),
 recommendations:bundle.recommendations.map(a=>({id:id('recommendation',a.id),recommendation_key:a.id,action_type:a.actionType,target:{domain:a.domain,owner:a.owner},title:a.title,summary:a.summary,reason:a.reason,expected_impact:a.expectedImpact,confidence:a.confidence,urgency:a.urgency,risk_class:a.approvalRequired?'approval_required':'review',verification_required:a.verificationRequired,approval_required:a.approvalRequired,safe_to_automate:false,status:a.status==='open'?'pending':a.status,generated_at:a.generatedAt,expires_at:a.expiresAt,payload:a,estate_id:s.estateId,home_id:home,privacy_class:policy.privacyClass,outcome:{},updated_at:at})),
 insights:bundle.insights.map(a=>({id:id('insight',a.id),domain:a.domain,insight_type:a.source,reasoning_version:'v3',title:a.title,summary:a.summary,reason:a.reason,impact:a.impact,confidence:a.confidence,evidence:a.evidence,owner:a.owner,verification:a.verification,next_step:a.nextStep,status:'open',generated_at:a.generatedAt})),
 plans:bundle.automationPlans.map(a=>({id:id('plan',a.id),plan_type:a.executionMode,canonical_operation_id:a.actionIntent,target:{entity:a.targetEntity,context:a.targetContext},preconditions:a.preconditions,safety_checks:a.safetyChecks,required_permissions:a.requiredPermissions,approval_state:a.approvalRequired?'required':'not_required',rollback_plan:a.rollbackPlan,status:a.status,generated_at:a.generatedAt,expires_at:a.expiresAt})),
 deliveries:[] as any[]};
 const channels=new Set(receipt.outputs.flatMap(o=>o==='activity'?['activity:event']:o==='notifications'?['notification:event']:o==='conversation'?['conversation:response']:o==='executive_intelligence'?['executive:briefing']:o==='digital_twin'?['future:digital-twin']:['infrastructure_registry','operational_intelligence'].includes(o)?['facility:awareness']:[]));
 rows.deliveries=[...channels].map(channel=>({id:id('delivery',channel),delivery_key:`canonical:${uuid(key)}:${channel}`,channel,audience:{privacy_class:policy.privacyClass,estate_id:s.estateId,home_id:home,actor_id:s.actor.id},payload:{signal_id:s.id,canonical_signal_key:key,awareness:bundle.awareness.map(a=>a.id),insights:bundle.insights.map(a=>a.id),recommendations:bundle.recommendations.map(a=>a.id),plans:bundle.automationPlans.map(a=>a.id),receipt:{outputs:receipt.outputs,accepted:receipt.accepted,duplicate:receipt.duplicate}},redaction_version:'v1',status:'pending',attempt_count:0,expires_at:new Date(Date.parse(at)+86400000).toISOString(),created_at:at,updated_at:at}));
 return {version:1,reasoning_version:'canonical-v3-final-a1',evaluated_at:at,incident,suppress_child:!!c?.suppressChildAwareness,rows};
}
export async function registerMaterialization(bundle: RuntimeBundle, receipt: SignalRuntimeReceipt) {
 const s=receipt.signal,policy=resolveIntelligencePolicy(s),key=canonicalSignalKey(s);
 const row={canonical_signal_key:key,producer:String(s.metadata.producer||s.source||'unknown'),provider:s.provider,provider_event_id:s.providerEventId,signal_type:s.type,domain:s.domain,severity:s.severity,confidence:s.confidence,trust_score:s.trustScore,verified:s.verified,verification_method:s.verificationMethod,estate_id:s.estateId,building_id:s.buildingId,home_id:homeIdFromSignal(s),room_id:s.room.id||s.metadata.room_id||null,entity_type:s.entity.type,entity_id:s.entity.id,actor_id:s.actor.id,privacy_class:policy.privacyClass,occurred_at:s.timestamp,payload:{signal:s,receipt:{accepted:receipt.accepted,duplicate:receipt.duplicate,outputs:receipt.outputs,issues:receipt.issues},output_policy:policy},runtime_id:s.runtimeId,correlation_id:s.correlationId,execution_id:s.metadata.execution_id||null};
 const {data,error}=await supabaseAdmin.rpc('oyi_register_materialization',{p_signal:row,p_prepared:prepareMaterialization(bundle,receipt)}); if(error)throw error;
 return materializationAck(data,key);
}
export async function reconcileMaterialization(limit=25,signalId:string|null=null) {
 const {data,error}=await supabaseAdmin.rpc('oyi_claim_materialization',{p_limit:limit,p_signal_id:signalId});if(error)throw error;
 const results=[];
 for(const row of data||[]) {
  const token=row.materialization.claim_token;
  operationalMetrics.increment('canonical_materialization_claims_total',{retry:Number(row.materialization.attempt_count)>1});
  try {const result=await supabaseAdmin.rpc('oyi_complete_materialization',{p_signal_id:row.id,p_token:token});if(result.error)throw result.error;operationalMetrics.increment('canonical_materialization_results_total',{result:result.data?.complete?'materialized':'stale_claim'});results.push({id:row.id,complete:result.data?.complete===true});}
  catch(error:any){const terminal=/^22|^23/.test(String(error?.code||''));const failed=await supabaseAdmin.rpc('oyi_fail_materialization',{p_signal_id:row.id,p_token:token,p_code:terminal?'invalid_prepared_materialization':'persistence_failed',p_terminal:terminal});if(failed.error)throw failed.error;operationalMetrics.increment('canonical_materialization_results_total',{result:terminal?'terminal_failure':'retryable_failure'});results.push({id:row.id,complete:false});}
 }
 return results;
}
/** Service-only programmatic diagnostic. Constant query count; never returns prepared/private payloads. */
export async function materializationDiagnostics() {
 const counts:Record<string,number>={};
 await Promise.all(['pending','materializing','retryable_failure','terminal_failure','materialized'].map(async state=>{
  const {count,error}=await supabaseAdmin.from('operational_signals').select('id',{count:'exact',head:true}).eq('materialization->>state',state);
  if(error)throw error;counts[state]=count||0;operationalMetrics.gauge('canonical_materialization_backlog',count||0,{state});
 }));
 const {data,error}=await supabaseAdmin.from('operational_signals').select('received_at').in('materialization->>state',['pending','materializing','retryable_failure']).order('received_at').limit(1);
 if(error)throw error;const oldestPendingAt=data?.[0]?.received_at||null;
 operationalMetrics.gauge('canonical_materialization_oldest_pending_seconds',oldestPendingAt?Math.max(0,(Date.now()-Date.parse(oldestPendingAt))/1000):0);
 return {counts,oldestPendingAt};
}
