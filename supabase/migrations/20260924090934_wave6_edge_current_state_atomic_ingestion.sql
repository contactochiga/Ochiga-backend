-- Source-time authority is isolated from legacy receipt-time mirrors. Existing
-- rows deliberately remain unobserved until an authenticated timestamped report.
begin;
alter table public.edge_nodes add column if not exists heartbeat_observed_at timestamptz;
alter table public.edge_nodes add column if not exists heartbeat_received_at timestamptz;
alter table public.edge_nodes add column if not exists heartbeat_observation jsonb;
alter table public.edge_heartbeats add column if not exists observed_at timestamptz;
create unique index if not exists edge_heartbeats_source_observation_key
  on public.edge_heartbeats(estate_id, edge_node_id, observed_at) where observed_at is not null;

create or replace function public.oyi_ingest_edge_heartbeat(
  p_estate_id uuid, p_edge_node_id text, p_heartbeat jsonb,
  p_expected_interval_ms integer default 30000
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_received timestamptz := clock_timestamp();
  v_observed timestamptz;
  v_node public.edge_nodes%rowtype;
  v_history_id uuid;
  v_latest boolean;
  v_observation jsonb;
  v_status text := lower(coalesce(nullif(p_heartbeat->>'status',''), 'unknown'));
  v_queue integer := coalesce((p_heartbeat->>'queue_depth')::integer,(p_heartbeat->>'outbox_depth')::integer,0);
  v_errors integer := coalesce((p_heartbeat->>'error_count')::integer,0);
begin
  if p_estate_id is null or nullif(btrim(p_edge_node_id),'') is null then
    raise exception 'edge_identity_required' using errcode='22023';
  end if;
  if nullif(p_heartbeat->>'ts','') is null or p_heartbeat->>'ts' !~* '(Z|[+-][0-9]{2}:[0-9]{2})$' then
    raise exception 'edge_observed_at_required' using errcode='22023';
  end if;
  v_observed := (p_heartbeat->>'ts')::timestamptz;
  if not isfinite(v_observed) or v_observed > v_received + interval '10 seconds' then
    raise exception 'edge_observed_at_future_or_invalid' using errcode='22023';
  end if;
  if p_expected_interval_ms is null or p_expected_interval_ms < 1000 or v_queue < 0 or v_errors < 0 then
    raise exception 'edge_invalid_observation' using errcode='22023';
  end if;
  -- Never accept payload tenant identity in preference to the authenticated args.
  if (p_heartbeat ? 'site_id' and p_heartbeat->>'site_id' <> p_estate_id::text)
     or (p_heartbeat ? 'agent_id' and p_heartbeat->>'agent_id' <> p_edge_node_id) then
    raise exception 'edge_identity_mismatch' using errcode='22023';
  end if;
  insert into public.edge_nodes(estate_id,edge_node_id,name)
    values(p_estate_id,p_edge_node_id,p_edge_node_id)
    on conflict(estate_id,edge_node_id) do nothing;
  -- Also serializes concurrent FIRST heartbeats via the unique identity insert.
  select * into strict v_node from public.edge_nodes
    where estate_id=p_estate_id and edge_node_id=p_edge_node_id for update;
  v_latest := v_node.heartbeat_observed_at is null or v_observed > v_node.heartbeat_observed_at;
  v_observation := jsonb_build_object(
    'version',1,'source','edge_heartbeat','observed_at',v_observed,'received_at',v_received,
    'status',v_status,'runtime_version',p_heartbeat->>'runtime_version',
    'queue_depth',v_queue,'sync_status',coalesce(p_heartbeat->>'sync_status','unknown'),
    'error_count',v_errors,'expected_interval_ms',p_expected_interval_ms,
    'interval_source','backend_expected_not_agent_confirmed');
  insert into public.edge_heartbeats(estate_id,edge_node_id,heartbeat_status,observed_at,received_at,
    local_runtime_host,camera_count,device_count,queue_depth,sync_status,error_count,runtime_version,metadata)
    values(p_estate_id,p_edge_node_id,v_status,v_observed,v_received,
      p_heartbeat->>'local_runtime_host',coalesce((p_heartbeat->>'camera_count')::integer,0),
      coalesce((p_heartbeat->>'device_count')::integer,0),v_queue,v_observation->>'sync_status',
      v_errors,p_heartbeat->>'runtime_version',v_observation || jsonb_build_object('ts',p_heartbeat->>'ts','accepted_latest',v_latest))
    on conflict(estate_id,edge_node_id,observed_at) where observed_at is not null do nothing returning id into v_history_id;
  if v_history_id is null then
    return jsonb_build_object('accepted',false,'disposition','duplicate','node',to_jsonb(v_node));
  end if;
  if v_latest then
    update public.edge_nodes set heartbeat_observed_at=v_observed,heartbeat_received_at=v_received,
      heartbeat_observation=v_observation,heartbeat_status=v_status,last_seen_at=v_observed,
      runtime_version=p_heartbeat->>'runtime_version',queue_depth=v_queue,
      sync_status=v_observation->>'sync_status',error_count=v_errors,
      camera_count=coalesce((p_heartbeat->>'camera_count')::integer,0),
      device_count=coalesce((p_heartbeat->>'device_count')::integer,0),
      local_runtime_host=coalesce(p_heartbeat->>'local_runtime_host',local_runtime_host),updated_at=v_received
      where id=v_node.id returning * into strict v_node;
  end if;
  return jsonb_build_object('accepted',v_latest,'disposition',case when v_latest then 'accepted' else 'older' end,
    'node',to_jsonb(v_node),'history_id',v_history_id);
end;
$$;
revoke all on function public.oyi_ingest_edge_heartbeat(uuid,text,jsonb,integer) from public, anon, authenticated;
grant execute on function public.oyi_ingest_edge_heartbeat(uuid,text,jsonb,integer) to service_role;
comment on function public.oyi_ingest_edge_heartbeat(uuid,text,jsonb,integer) is
  'Trusted Backend only: atomic source-time-ordered Edge observation + history. No camera writes.';
commit;
