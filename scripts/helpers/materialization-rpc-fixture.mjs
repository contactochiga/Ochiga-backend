import {randomUUID} from 'node:crypto';
// Functional harness only. SQL locking/rollback guarantees are tested against PostgreSQL.
export function materializationRpcFixture(db,name,args){
 db.operational_signals??=[];
 if(name==='oyi_register_materialization'){
  let row=db.operational_signals.find(r=>r.canonical_signal_key===args.p_signal.canonical_signal_key);const duplicate=!!row;
  if(!row){row={id:randomUUID(),...structuredClone(args.p_signal),materialization:{state:'pending',prepared:structuredClone(args.p_prepared),attempt_count:0}};db.operational_signals.push(row)}
  return{data:{signal_id:row.id,key:row.canonical_signal_key,state:row.materialization?.state||'legacy_unverified',duplicate},error:null};
 }
 if(name==='oyi_claim_materialization'){
  const rows=db.operational_signals.filter(r=>(!args.p_signal_id||r.id===args.p_signal_id)&&['pending','retryable_failure'].includes(r.materialization?.state)).slice(0,args.p_limit);
  rows.forEach(r=>Object.assign(r.materialization,{state:'materializing',claim_token:randomUUID(),attempt_count:r.materialization.attempt_count+1}));return{data:structuredClone(rows),error:null};
 }
 const row=db.operational_signals.find(r=>r.id===args.p_signal_id);
 if(name==='oyi_fail_materialization'){row.materialization.state=args.p_terminal?'terminal_failure':'retryable_failure';return{data:true,error:null}}
 if(name==='oyi_complete_materialization'){
  if(row.materialization.claim_token!==args.p_token)return{data:{complete:false},error:null};
  const p=row.materialization.prepared;db.operational_incidents??=[];let incident;
  if(p.incident){incident=db.operational_incidents.find(r=>r.incident_key===p.incident.incident_key);if(!incident){incident={id:randomUUID(),...structuredClone(p.incident)};db.operational_incidents.push(incident)}else if(Date.parse(p.incident.last_seen_at)>Date.parse(incident.last_seen_at))Object.assign(incident,structuredClone(p.incident));}
  for(const [kind,table,key] of [['awareness','operational_awareness','awareness_key'],['recommendations','operational_recommendations','recommendation_key'],['insights','operational_insights','id'],['plans','operational_plans','id'],['deliveries','operational_delivery_outbox','delivery_key']]){
   db[table]??=[];for(const item of p.rows[kind])if(!db[table].some(r=>r[key]===item[key]))db[table].push({...structuredClone(item),incident_id:kind==='awareness'&&p.suppress_child?null:incident?.id||null});
  }
  row.materialization.state='materialized';return{data:{complete:true},error:null};
 }
 throw Error('Unexpected materialization fixture RPC '+name);
}
