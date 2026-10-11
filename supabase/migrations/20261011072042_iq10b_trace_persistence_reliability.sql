begin;

-- Additive writer/schema repair; old traces remain readable with NULL fields.
alter table public.oyi_conversation_traces
  add column if not exists planner_admitted boolean,
  add column if not exists planner_admission_reason text;

-- The existing canonical writer supplies these rows. This transaction is not
-- a second persistence system and cannot be called by frontend roles.
create or replace function public.oyi_persist_canonical_turn(
  p_thread jsonb, p_user jsonb, p_assistant jsonb, p_request_id text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  tid uuid := (p_thread->>'id')::uuid;
  existing public.oyi_conversation_threads%rowtype;
  n integer;
  uid uuid;
  aid uuid;
begin
  if current_user <> 'service_role' and current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'canonical_writer_only';
  end if;
  if p_request_id is null or length(p_request_id) not between 1 and 256
    or p_user->>'thread_id' <> tid::text or p_assistant->>'thread_id' <> tid::text
    or p_user->>'role' <> 'user' or p_assistant->>'role' <> 'assistant'
    or p_user->'metadata'->>'conversation_request_id' is distinct from p_request_id
    or p_assistant->'metadata'->>'conversation_request_id' is distinct from p_request_id
    or p_user->>'user_id' is distinct from p_thread->>'user_id'
    or p_assistant->>'user_id' is distinct from p_thread->>'user_id' then
    raise exception using errcode = '22023', message = 'canonical_turn_contract_mismatch';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(tid::text, 0));
  select * into existing from public.oyi_conversation_threads where id = tid;
  if found and (existing.user_id::text is distinct from p_thread->>'user_id'
    or existing.surface is distinct from p_thread->>'surface') then
    raise exception using errcode = '42501', message = 'canonical_thread_owner_mismatch';
  end if;
  select count(*) into n from public.oyi_conversation_messages
    where thread_id = tid and metadata->>'conversation_request_id' = p_request_id;
  if n > 0 then
    select id into uid from public.oyi_conversation_messages where thread_id = tid
      and metadata->>'conversation_request_id' = p_request_id and role = 'user' and content = p_user->>'content';
    select id into aid from public.oyi_conversation_messages where thread_id = tid
      and metadata->>'conversation_request_id' = p_request_id and role = 'assistant' and content = p_assistant->>'content';
    if n <> 2 or uid is null or aid is null then
      raise exception using errcode = '23505', message = 'canonical_turn_identity_conflict';
    end if;
    return jsonb_build_object('saved', true, 'duplicate', true, 'user_message_id', uid, 'assistant_message_id', aid);
  end if;
  insert into public.oyi_conversation_threads (id,user_id,surface,estate_id,home_id,module,title,updated_at,metadata)
    select r.id,r.user_id,r.surface,r.estate_id,r.home_id,r.module,r.title,r.updated_at,r.metadata
    from jsonb_populate_record(null::public.oyi_conversation_threads,p_thread) r
    on conflict (id) do update set title=excluded.title, updated_at=excluded.updated_at,
      metadata=coalesce(public.oyi_conversation_threads.metadata,'{}'::jsonb) || excluded.metadata;
  insert into public.oyi_conversation_messages (id,thread_id,user_id,role,content,cards,sources,suggested_actions,metadata,created_at)
    select r.id,r.thread_id,r.user_id,r.role,r.content,coalesce(r.cards,'[]'::jsonb),coalesce(r.sources,'[]'::jsonb),
      coalesce(r.suggested_actions,'[]'::jsonb),r.metadata,r.created_at
    from jsonb_populate_recordset(null::public.oyi_conversation_messages,jsonb_build_array(p_user,p_assistant)) r;
  select count(*) into n from public.oyi_conversation_messages where thread_id=tid;
  update public.oyi_conversation_threads set metadata=metadata || jsonb_build_object(
    'message_count',n,'last_user_message_id',p_user->>'id','last_assistant_message_id',p_assistant->>'id',
    'last_conversation_request_id',p_request_id) where id=tid;
  return jsonb_build_object('saved',true,'duplicate',false,'user_message_id',p_user->>'id','assistant_message_id',p_assistant->>'id');
end $$;

create or replace function public.oyi_collapse_canonical_exchange(
  p_thread_id uuid, p_request_ids text[], p_original text, p_answer text, p_keep_last boolean
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  ids uuid[];
  user_id_keep uuid;
  assistant_id_keep uuid;
  n integer;
begin
  if current_user <> 'service_role' and current_user <> 'postgres' then
    raise exception using errcode='42501', message='canonical_writer_only';
  end if;
  if coalesce(cardinality(p_request_ids),0) < 1 or cardinality(p_request_ids) > 16 then
    raise exception using errcode='22023', message='invalid_collapse_request_ids';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_thread_id::text,0));
  select array_agg(id),count(*) into ids,n from public.oyi_conversation_messages
    where thread_id=p_thread_id and metadata->>'conversation_request_id'=any(p_request_ids);
  if n <> cardinality(p_request_ids)*2 then
    return jsonb_build_object('collapsed',false,'reason','rows_unavailable');
  end if;
  if exists(select 1 from unnest(p_request_ids) rid where
    (select count(distinct role) from public.oyi_conversation_messages where thread_id=p_thread_id
      and metadata->>'conversation_request_id'=rid and role in ('user','assistant')) <> 2) then
    return jsonb_build_object('collapsed',false,'reason','unexpected_row_shape');
  end if;
  select id into user_id_keep from public.oyi_conversation_messages where thread_id=p_thread_id and role='user'
    and metadata->>'conversation_request_id'=p_request_ids[case when p_keep_last then cardinality(p_request_ids) else 1 end];
  select id into assistant_id_keep from public.oyi_conversation_messages where thread_id=p_thread_id and role='assistant'
    and metadata->>'conversation_request_id'=p_request_ids[cardinality(p_request_ids)];
  update public.oyi_conversation_messages set content=case when role='user' then p_original else p_answer end,
    metadata=metadata || jsonb_build_object('multipart',jsonb_build_object('clauses',cardinality(p_request_ids),'collapsed',true),
      'conversation_request_ids',to_jsonb(p_request_ids)) where id in (user_id_keep,assistant_id_keep);
  delete from public.oyi_conversation_messages where thread_id=p_thread_id and id=any(ids) and id not in (user_id_keep,assistant_id_keep);
  select count(*) into n from public.oyi_conversation_messages where thread_id=p_thread_id;
  update public.oyi_conversation_threads set metadata=metadata || jsonb_build_object('message_count',n,
    'last_user_message_id',user_id_keep,'last_assistant_message_id',assistant_id_keep) where id=p_thread_id;
  return jsonb_build_object('collapsed',true);
end $$;

revoke all on function public.oyi_persist_canonical_turn(jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.oyi_persist_canonical_turn(jsonb,jsonb,jsonb,text) to service_role;
revoke all on function public.oyi_collapse_canonical_exchange(uuid,text[],text,text,boolean) from public,anon,authenticated;
grant execute on function public.oyi_collapse_canonical_exchange(uuid,text[],text,text,boolean) to service_role;
notify pgrst, 'reload schema';
commit;
