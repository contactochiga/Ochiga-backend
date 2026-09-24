begin;
alter table public.facility_cameras add column if not exists health_transition_checkpoint jsonb;
comment on column public.facility_cameras.health_transition_checkpoint is 'Transition/delivery bookkeeping only. Never camera current-state truth.';
create table public.camera_health_transition_outbox (
  transition_id text primary key,
  camera_id uuid not null references public.facility_cameras(id),
  estate_id uuid not null,
  home_id uuid,
  checkpoint_revision bigint not null,
  previous_state text,
  current_state text not null check(current_state in ('healthy','degraded','unavailable','unknown')),
  transition_type text not null check(transition_type in ('camera.health.degraded','camera.video.unavailable','camera.video.restored','camera.health.improved')),
  policy_revision text not null,
  evaluated_at timestamptz not null,
  payload jsonb not null check(octet_length(payload::text)<=16384),
  delivery_state text not null default 'pending' check(delivery_state in ('pending','submitting','retryable_failure','materialized')),
  attempt_count integer not null default 0 check(attempt_count>=0),
  claim_token uuid,
  lease_until timestamptz,
  last_attempt_at timestamptz,
  acknowledged_at timestamptz,
  error_code text check(length(error_code)<=80),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(camera_id,checkpoint_revision)
);
create index camera_health_transition_pending on public.camera_health_transition_outbox(delivery_state,created_at);
alter table public.camera_health_transition_outbox enable row level security;
revoke all on public.camera_health_transition_outbox from public,anon,authenticated;
grant select,insert,update on public.camera_health_transition_outbox to service_role;

create function public.oyi_accept_camera_health_transition(
  p_camera_id uuid, p_expected_camera jsonb, p_expected_edge jsonb,
  p_expected_checkpoint jsonb, p_evaluation jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  c public.facility_cameras%rowtype; e jsonb; k text; cp jsonb; revision bigint;
  at_time timestamptz; deadline timestamptz; event_type text; transition_id text; next_cp jsonb; item jsonb;
begin
  if jsonb_typeof(p_expected_camera) is distinct from 'object' or jsonb_typeof(p_evaluation) is distinct from 'object'
    or octet_length(p_expected_camera::text)>1048576 or octet_length(p_evaluation::text)>16384 then
    raise exception 'invalid_transition_evaluation' using errcode='22023';
  end if;
  -- Covers absent-node insertion as well as existing-node change. Short shared
  -- table lock; no per-node gap lock exists in the frozen heartbeat contract.
  lock table public.edge_nodes in share mode;
  -- Lock Edge first; heartbeat ingestion locks only Edge, camera ingestion only camera.
  select jsonb_build_object('id',n.id,'estate_id',n.estate_id,'edge_node_id',n.edge_node_id,
    'heartbeat_observed_at',n.heartbeat_observed_at,'heartbeat_received_at',n.heartbeat_received_at,
    'heartbeat_observation',n.heartbeat_observation) into e
    from public.edge_nodes n where n.estate_id=(p_expected_camera->>'estate_id')::uuid
      and n.edge_node_id=p_expected_camera->>'edge_node_id' for share;
  select * into c from public.facility_cameras where id=p_camera_id for update;
  if not found then raise exception 'camera_not_found' using errcode='42501'; end if;
  for k in select unnest(array['id','estate_id','home_id','privacy_scope','metadata','edge_node_id','nvr_id','channel','ai_enabled','runtime_observations']) loop
    if not(p_expected_camera ? k) or to_jsonb(c)->k is distinct from p_expected_camera->k then
      return jsonb_build_object('accepted',false,'reason','camera_evidence_changed');
    end if;
  end loop;
  -- jsonb timestamp text formatting varies; compare typed times and exact payload/identity.
  if (e is null) <> (p_expected_edge is null or p_expected_edge='null'::jsonb) then
    return jsonb_build_object('accepted',false,'reason','edge_evidence_changed');
  end if;
  if e is not null and ((e-array['heartbeat_observed_at','heartbeat_received_at']) is distinct from
      (p_expected_edge-array['heartbeat_observed_at','heartbeat_received_at']) or
      (e->>'heartbeat_observed_at')::timestamptz is distinct from (p_expected_edge->>'heartbeat_observed_at')::timestamptz or
      (e->>'heartbeat_received_at')::timestamptz is distinct from (p_expected_edge->>'heartbeat_received_at')::timestamptz) then
    return jsonb_build_object('accepted',false,'reason','edge_evidence_changed');
  end if;
  cp:=c.health_transition_checkpoint;
  if cp is distinct from nullif(p_expected_checkpoint,'null'::jsonb) then
    return jsonb_build_object('accepted',false,'reason','checkpoint_changed');
  end if;
  at_time:=(p_evaluation->>'evaluated_at')::timestamptz;
  deadline:=(p_evaluation->>'valid_until')::timestamptz;
  if at_time is null or deadline is null or not isfinite(at_time) or not isfinite(deadline) or at_time>clock_timestamp() or
     deadline<=clock_timestamp() or deadline>at_time+interval '1 second' or at_time<(cp->>'evaluated_at')::timestamptz then
    return jsonb_build_object('accepted',false,'reason','evaluation_expired');
  end if;
  -- Fixed summary only: no arbitrary diagnostics, credentials or media payloads.
  if coalesce(p_evaluation->'summary'->>'scope_revision','') !~ '^[a-f0-9]{64}$'
    or length(coalesce(p_evaluation->'summary'->>'policy_key','')) not between 1 and 256
    or (p_evaluation->'summary'->>'policy_key') !~ '^[a-zA-Z0-9_./,"\[\] -]+$' then
    raise exception 'invalid_summary_revision' using errcode='22023';
  end if;
  if jsonb_typeof(p_evaluation->'summary'->'components') is distinct from 'object' then
    raise exception 'invalid_component_summary' using errcode='22023';
  end if;
  for k,item in select key,value from jsonb_each(p_evaluation->'summary'->'components') loop
    if k not in ('frame','stream','reachability','inference','edge') or jsonb_typeof(item)<>'string'
      or (item#>>'{}') !~ '^[a-z_]{1,64}$' then
      raise exception 'invalid_component_summary' using errcode='22023';
    end if;
  end loop;
  for item in select value from jsonb_array_elements(p_evaluation->'summary'->'reasons') loop
    if jsonb_typeof(item)<>'string' or (item#>>'{}') !~ '^[a-zA-Z0-9_.:/-]{1,256}$' or (item#>>'{}') like '%://%' then
      raise exception 'invalid_reason_summary' using errcode='22023';
    end if;
  end loop;
  for item in select value from jsonb_array_elements(p_evaluation->'summary'->'evidence') loop
    if jsonb_typeof(item)<>'object' or exists(select 1 from jsonb_object_keys(item) key where key not in ('id','source','observed_at'))
      or coalesce(item->>'id','') !~ '^[a-zA-Z0-9_.:-]{1,160}$'
      or coalesce(item->>'source','') !~ '^[a-zA-Z0-9_.:-]{1,160}$'
      or not isfinite((item->>'observed_at')::timestamptz) or item->>'observed_at' is null then
      raise exception 'invalid_evidence_summary' using errcode='22023';
    end if;
  end loop;
  if p_evaluation->>'policy_revision' is distinct from 'camera-transition-v1/current-state-14d-v1' or
     coalesce(p_evaluation->>'overall','') not in ('healthy','degraded','unavailable','unknown') or
     jsonb_typeof(p_evaluation->'summary') is distinct from 'object' then
    raise exception 'invalid_transition_policy' using errcode='22023';
  end if;
  event_type:=nullif(p_evaluation->>'transition_type','');
  if coalesce(jsonb_typeof(p_evaluation->'summary'->'reasons'),'') <> 'array'
    or coalesce(jsonb_typeof(p_evaluation->'summary'->'evidence'),'') <> 'array'
    or jsonb_array_length(p_evaluation->'summary'->'reasons')>32
    or jsonb_array_length(p_evaluation->'summary'->'evidence')>16
    or exists(select 1 from jsonb_object_keys(p_evaluation->'summary') key where key not in ('components','reasons','evidence','scope_revision','policy_key')) then
    raise exception 'invalid_transition_summary' using errcode='22023';
  end if;
  if event_type is not null and event_type not in ('camera.health.degraded','camera.video.unavailable','camera.video.restored','camera.health.improved') then
    raise exception 'invalid_transition_type' using errcode='22023';
  end if;
  if event_type is not null and (p_evaluation->>'overall'='unknown' or cp->>'overall'=p_evaluation->>'overall') then
    raise exception 'unchanged_or_unknown_cannot_signal_health' using errcode='22023';
  end if;
  if cp is not null and event_type is not null and
    (cp->'summary'->>'scope_revision' is distinct from p_evaluation->'summary'->>'scope_revision' or
     cp->'summary'->>'policy_key' is distinct from p_evaluation->'summary'->>'policy_key') then
    raise exception 'policy_scope_rebaseline_must_be_silent' using errcode='22023';
  end if;
  -- TypeScript owns meaning; SQL only enforces initialization/version consistency and CAS.
  if (cp is null or cp->>'policy_revision' is distinct from p_evaluation->>'policy_revision') and event_type='camera.video.restored' then
    raise exception 'initialization_is_not_recovery' using errcode='22023';
  end if;
  if cp is not null and cp->>'policy_revision' is distinct from p_evaluation->>'policy_revision' and event_type is not null then
    raise exception 'policy_rebaseline_must_be_silent' using errcode='22023';
  end if;
  revision:=coalesce((cp->>'revision')::bigint,0)+1;
  transition_id:='camera-health:'||p_camera_id::text||':'||revision::text;
  next_cp:=jsonb_build_object('revision',revision,'overall',p_evaluation->>'overall',
    'policy_revision',p_evaluation->>'policy_revision','evaluated_at',at_time,
    'evidence_revision',md5(coalesce(c.runtime_observations::text,'null')),
    'edge_revision',md5(coalesce(e::text,'null')),'summary',p_evaluation->'summary');
  update public.facility_cameras set health_transition_checkpoint=next_cp where id=p_camera_id;
  if event_type is not null then
    insert into public.camera_health_transition_outbox(transition_id,camera_id,estate_id,home_id,checkpoint_revision,
      previous_state,current_state,transition_type,policy_revision,evaluated_at,payload)
    values(transition_id,c.id,c.estate_id,coalesce(c.home_id,nullif(c.metadata->>'home_id','')::uuid,
      nullif(c.metadata->>'homeId','')::uuid,nullif(c.metadata->>'bound_home_id','')::uuid,nullif(c.metadata->>'private_home_id','')::uuid),revision,cp->>'overall',p_evaluation->>'overall',event_type,
      p_evaluation->>'policy_revision',at_time,jsonb_build_object('summary',p_evaluation->'summary',
        'evidence_revision',next_cp->>'evidence_revision','edge_revision',next_cp->>'edge_revision'));
  end if;
  return jsonb_build_object('accepted',true,'checkpoint',next_cp,'transition_id',case when event_type is null then null else transition_id end);
end;
$$;
revoke all on function public.oyi_accept_camera_health_transition(uuid,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.oyi_accept_camera_health_transition(uuid,jsonb,jsonb,jsonb,jsonb) to service_role;
commit;
