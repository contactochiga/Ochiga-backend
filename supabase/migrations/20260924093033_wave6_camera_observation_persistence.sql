begin;
alter table public.facility_cameras add column if not exists runtime_observations jsonb;
comment on column public.facility_cameras.runtime_observations is
  'Backend-owned v1 latest component observations, not overall health or a journal. No legacy backfill.';

create or replace function public.oyi_ingest_camera_observations(
  p_estate_id uuid, p_edge_node_id text, p_observations jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  received timestamptz := clock_timestamp();
  item jsonb; detail jsonb; prior jsonb; success jsonb; entry jsonb; projection jsonb; accepted jsonb := '[]';
  camera record; camera_ids uuid[]; kind text; src text; result text; slot text; k text; v jsonb;
  observed timestamptz; wins boolean; success_wins boolean;
begin
  if p_estate_id is null or nullif(btrim(p_edge_node_id),'') is null or length(p_edge_node_id)>200 then
    raise exception 'camera_observation_identity_required' using errcode='22023';
  end if;
  if jsonb_typeof(p_observations) is distinct from 'array' or octet_length(p_observations::text)>524288 then
    raise exception 'camera_observation_batch_invalid' using errcode='22023';
  end if;
  if jsonb_array_length(p_observations) not between 1 and 128 then
    raise exception 'camera_observation_batch_bound' using errcode='22023';
  end if;
  -- Validate the entire input before taking locks or changing any row.
  for item in select value from jsonb_array_elements(p_observations) loop
    if jsonb_typeof(item) is distinct from 'object' or item->>'schema_version' is distinct from '1'
      or item->>'edge_node_id' is distinct from p_edge_node_id
      or coalesce(item->>'camera_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(item->>'observation_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or exists(select 1 from jsonb_object_keys(item) key where key not in ('schema_version','observation_id','camera_id','edge_node_id','kind','source','observed_at','result','details')) then
      raise exception 'camera_observation_envelope_invalid' using errcode='22023';
    end if;
    if coalesce(item->>'observed_at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
      raise exception 'camera_observation_timestamp_invalid' using errcode='22023';
    end if;
    observed := (item->>'observed_at')::timestamptz;
    if not isfinite(observed) or observed < '2000-01-01Z'::timestamptz or observed > received+interval '10 seconds' then
      raise exception 'camera_observation_timestamp_range' using errcode='22023';
    end if;
    kind := item->>'kind'; src := item->>'source'; result := item->>'result';
    if not coalesce(
      (kind='stream_configuration' and src='go2rtc_registry' and result in ('configured','not_configured')) or
      (kind='stream' and src='go2rtc_inspection' and result in ('inspected','failed')) or
      (kind='reachability' and src in ('onvif_probe','tcp_probe') and result in ('succeeded','failed','authentication_failed')) or
      (kind='frame' and src in ('go2rtc_snapshot','ai_snapshot','media_ingestion') and result in ('acquired','failed')) or
      (kind='inference' and src='external_detector' and result in ('succeeded','failed','skipped','dropped')),false) then
      raise exception 'camera_observation_kind_source_result_invalid' using errcode='22023';
    end if;
    detail := coalesce(item->'details','{}');
    if jsonb_typeof(detail) is distinct from 'object' or octet_length(detail::text)>2048 then
      raise exception 'camera_observation_details_invalid' using errcode='22023';
    end if;
    for k,v in select * from jsonb_each(detail) loop
      if not ((kind='stream' and k in ('stream_present','producer_count','consumer_count','error_code')) or
        (kind='reachability' and k in ('port','latency_ms','error_code')) or
        (kind='frame' and k in ('mime_type','validation','size_bytes','latency_ms','media_id','error_code')) or
        (kind='inference' and k in ('detection_count','queue_depth','latency_ms','dropped_samples','error_code'))) then
        raise exception 'camera_observation_details_key_denied' using errcode='22023';
      end if;
      if k in ('producer_count','consumer_count','port','latency_ms','size_bytes','detection_count','queue_depth','dropped_samples') then
        if jsonb_typeof(v)<>'number' or (v::text)::numeric<0 or (v::text)::numeric>52428800 then
          raise exception 'camera_observation_metric_invalid' using errcode='22023'; end if;
      elsif k='stream_present' then
        if jsonb_typeof(v)<>'boolean' then raise exception 'camera_observation_boolean_invalid' using errcode='22023'; end if;
      elsif k='mime_type' then
        if v #>> '{}' not in ('image/jpeg','image/webp') then raise exception 'camera_observation_mime_invalid' using errcode='22023'; end if;
      elsif k='validation' then
        if v #>> '{}' <> 'bounded_image_signature' then raise exception 'camera_observation_validation_invalid' using errcode='22023'; end if;
      elsif k='media_id' then
        if coalesce(v #>> '{}','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'camera_observation_media_invalid' using errcode='22023'; end if;
      elsif k='error_code' then
        if v #>> '{}' not in ('inspection_failed','capture_failed','invalid_image','probe_failed','authentication_failed','provider_failed','not_configured','sampling_bound') then raise exception 'camera_observation_error_invalid' using errcode='22023'; end if;
      end if;
      if v='null'::jsonb or jsonb_typeof(v) in ('object','array') then raise exception 'camera_observation_detail_value_invalid' using errcode='22023'; end if;
    end loop;
    if kind='frame' and result='acquired' and (detail->>'validation' is distinct from 'bounded_image_signature' or not(detail ? 'size_bytes') or not(detail ? 'mime_type')) then
      raise exception 'camera_frame_evidence_required' using errcode='22023';
    end if;
    if kind='frame' and result='acquired' and ((detail->>'size_bytes')::numeric<=0 or (detail->>'size_bytes')::numeric>5242880) then
      raise exception 'camera_frame_size_invalid' using errcode='22023';
    end if;
    if (detail ? 'media_id' and (src<>'media_ingestion' or detail->>'media_id' is distinct from item->>'observation_id'))
      or (src='media_ingestion' and (result<>'acquired' or not(detail ? 'media_id'))) then
      raise exception 'camera_media_correlation_invalid' using errcode='22023';
    end if;
  end loop;
  select array_agg(distinct (value->>'camera_id')::uuid) into camera_ids from jsonb_array_elements(p_observations);
  -- Deterministic lock order, then tenant/assignment checks on the locked row.
  for camera in select id,estate_id,edge_node_id,runtime_observations from public.facility_cameras
    where id=any(camera_ids) order by id for update loop
    if camera.estate_id is distinct from p_estate_id or camera.edge_node_id is distinct from p_edge_node_id then
      raise exception 'camera_assignment_denied' using errcode='42501';
    end if;
  end loop;
  if (select count(*) from public.facility_cameras where id=any(camera_ids))<>cardinality(camera_ids) then
    raise exception 'camera_assignment_denied' using errcode='42501';
  end if;
  for camera in select id,runtime_observations from public.facility_cameras where id=any(camera_ids) order by id loop
    projection := coalesce(camera.runtime_observations,'{"version":1,"dimensions":{}}'::jsonb);
    if projection->>'version' is distinct from '1' or jsonb_typeof(projection->'dimensions') is distinct from 'object' then
      raise exception 'camera_observation_projection_invalid' using errcode='55000';
    end if;
    for item in select value from jsonb_array_elements(p_observations) where (value->>'camera_id')::uuid=camera.id loop
      slot := (item->>'kind')||':'||(item->>'source');
      entry := coalesce(projection->'dimensions'->slot,'{}'); prior := entry->'latest'; success := entry->'last_success';
      -- Retained-ID mutation is invalid, not a new observation. No permanent ID journal is claimed.
      if (prior->>'observation_id'=item->>'observation_id' and prior-'received_at'<>item) or
         (success->>'observation_id'=item->>'observation_id' and success-'received_at'<>item) then
        raise exception 'camera_observation_id_conflict' using errcode='22023';
      end if;
      observed := (item->>'observed_at')::timestamptz;
      wins := prior is null or (observed,(item->>'observation_id') collate "C") > ((prior->>'observed_at')::timestamptz,(prior->>'observation_id') collate "C");
      success_wins := item->>'kind'='frame' and item->>'result'='acquired' and
        (success is null or (observed,(item->>'observation_id') collate "C") > ((success->>'observed_at')::timestamptz,(success->>'observation_id') collate "C"));
      if wins then entry := jsonb_set(entry,'{latest}',item||jsonb_build_object('received_at',received)); end if;
      if success_wins then entry := jsonb_set(entry,'{last_success}',item||jsonb_build_object('received_at',received)); end if;
      if wins or success_wins then projection := jsonb_set(projection,array['dimensions',slot],entry); end if;
      accepted := accepted || jsonb_build_array(jsonb_build_object('observation_id',item->>'observation_id','advanced',coalesce(wins or success_wins,false)));
    end loop;
    update public.facility_cameras set runtime_observations=projection where id=camera.id and runtime_observations is distinct from projection;
  end loop;
  return jsonb_build_object('ok',true,'results',accepted);
end;
$$;
revoke all on function public.oyi_ingest_camera_observations(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.oyi_ingest_camera_observations(uuid,text,jsonb) to service_role;
commit;
