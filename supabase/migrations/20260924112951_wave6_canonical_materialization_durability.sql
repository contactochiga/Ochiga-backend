-- Final A: processing bookkeeping only. NULL means legacy/unverified.
alter table public.operational_signals add column if not exists materialization jsonb;
alter table public.operational_signals add constraint operational_signal_materialization_shape check (
 materialization is null or (jsonb_typeof(materialization)='object'
 and coalesce(materialization->>'version'='1',false)
 and coalesce(materialization->>'state' in ('pending','materializing','materialized','retryable_failure','terminal_failure'),false)
 and octet_length(materialization::text)<=2097152));
create index operational_signal_materialization_due on public.operational_signals
 ((materialization->>'state'),(materialization->>'due_at'),id)
 where materialization is not null and materialization->>'state' in ('pending','materializing','retryable_failure');

create function public.oyi_register_materialization(p_signal jsonb,p_prepared jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.operational_signals; k text:=p_signal->>'canonical_signal_key'; n timestamptz:=clock_timestamp();
begin
 if k is null or length(k)=0 or length(k)>2048 or jsonb_typeof(p_prepared) is distinct from 'object'
 or p_prepared->>'version' is distinct from '1' or octet_length(p_prepared::text)>1048576
 or octet_length(p_signal::text)>524288 then raise exception 'invalid_prepared_materialization'; end if;
 if jsonb_typeof(p_prepared->'rows') is distinct from 'object' then raise exception 'invalid_prepared_rows'; end if;
 if not ((p_prepared->'rows') ?& array['awareness','recommendations','insights','plans','deliveries']) or exists(select 1 from jsonb_each(p_prepared->'rows') x where x.key not in
 ('awareness','recommendations','insights','plans','deliveries') or jsonb_typeof(x.value)<>'array' or jsonb_array_length(x.value)>100)
 or p_prepared->'rows' is null then raise exception 'invalid_prepared_rows'; end if;
 -- JSON populates a fixed table type, never executable SQL. Authority fields below are server-owned.
 insert into public.operational_signals
 select (jsonb_populate_record(null::public.operational_signals,p_signal||jsonb_build_object(
 'id',gen_random_uuid(),'created_at',n,'received_at',n,'materialization',jsonb_build_object(
 'version',1,'state','pending','attempt_count',0,'due_at',to_char(n at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'prepared',p_prepared)))).*
 on conflict(canonical_signal_key) do nothing returning * into r;
 if r.id is null then
 select * into strict r from public.operational_signals where canonical_signal_key=k;
 return jsonb_build_object('signal_id',r.id,'key',k,'duplicate',true,'state',coalesce(r.materialization->>'state','legacy_unverified'));
 end if;
 return jsonb_build_object('signal_id',r.id,'key',k,'duplicate',false,'state','pending');
end $$;

create function public.oyi_claim_materialization(p_limit integer default 25,p_signal_id uuid default null) returns setof public.operational_signals
language plpgsql security invoker set search_path='' as $$
declare r public.operational_signals; n timestamptz:=clock_timestamp();
begin
 if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'invalid_claim_limit'; end if;
 for r in select * from public.operational_signals
 where materialization->>'state' in ('pending','materializing','retryable_failure')
 and materialization->>'due_at'<=to_char(n at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
 and (p_signal_id is null or id=p_signal_id)
 order by materialization->>'due_at',id limit p_limit for update skip locked loop
 update public.operational_signals set materialization=materialization||jsonb_build_object(
 'state','materializing','attempt_count',coalesce((materialization->>'attempt_count')::int,0)+1,
 'claim_token',gen_random_uuid(),'due_at',to_char((n+interval '60 seconds') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
 where id=r.id returning * into r;
 return next r;
 end loop;
end $$;

create function public.oyi_fail_materialization(p_signal_id uuid,p_token uuid,p_code text,p_terminal boolean default false) returns boolean
language plpgsql security invoker set search_path='' as $$
declare r public.operational_signals; n timestamptz:=clock_timestamp();
begin
 select * into r from public.operational_signals where id=p_signal_id for update;
 n:=clock_timestamp();
 if r.materialization->>'state' is distinct from 'materializing' or r.materialization->>'claim_token' is distinct from p_token::text
 or (r.materialization->>'due_at')::timestamptz<=n then return false; end if;
 if p_code !~ '^[a-z0-9_]{1,80}$' then raise exception 'invalid_failure_code'; end if;
 update public.operational_signals set materialization=(materialization-'claim_token')||jsonb_build_object(
 'state',case when p_terminal then 'terminal_failure' else 'retryable_failure' end,'last_error_code',p_code,
 'due_at',to_char((n+make_interval(secs=>least(3600,5*power(2,least(10,(r.materialization->>'attempt_count')::int)))::double precision)) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) where id=p_signal_id;
 return true;
end $$;

create function public.oyi_complete_materialization(p_signal_id uuid,p_token uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.operational_signals; p jsonb; i jsonb; x jsonb; existing public.operational_incidents;
 v_incident_id uuid; n timestamptz:=clock_timestamp(); newer boolean; v_incident_key text; ordering jsonb; prior_order jsonb;
begin
 select * into strict r from public.operational_signals where id=p_signal_id for update;
 n:=clock_timestamp();
 if r.materialization->>'state'='materialized' then return jsonb_build_object('complete',true,'duplicate',true); end if;
 if r.materialization->>'state' is distinct from 'materializing' or r.materialization->>'claim_token' is distinct from p_token::text
 or (r.materialization->>'due_at')::timestamptz<=n then return jsonb_build_object('complete',false,'reason','stale_claim'); end if;
 p:=r.materialization->'prepared'; i:=p->'incident';
 if i is not null and i<>'null'::jsonb then
 v_incident_key:=i->>'incident_key';
 -- Serialize creation as well as updates for this correlation key, not the whole incident table.
 perform pg_advisory_xact_lock(hashtextextended(v_incident_key,0));
 select * into existing from public.operational_incidents t where t.incident_key=v_incident_key for update;
 v_incident_id:=coalesce(existing.id,gen_random_uuid());
 ordering:=jsonb_build_object('occurred_at',r.occurred_at,'accepted_at',r.received_at,'signal_key',r.canonical_signal_key,'written_at',n);
 prior_order:=existing.scope->'_materialization_order';
 newer:=existing.id is null or r.occurred_at>existing.last_seen_at or
 (r.occurred_at=existing.last_seen_at and prior_order is not null and
 (r.received_at,r.canonical_signal_key)>((prior_order->>'accepted_at')::timestamptz,prior_order->>'signal_key'));
 -- A later non-participating/manual edit must not be overwritten by delayed work.
 if existing.id is not null and existing.updated_at>r.received_at and
 (prior_order is null or existing.updated_at is distinct from (prior_order->>'written_at')::timestamptz) then newer:=false; end if;
 if existing.id is null then
 insert into public.operational_incidents select (jsonb_populate_record(null::public.operational_incidents,
 i||jsonb_build_object('id',v_incident_id,'created_at',n,'updated_at',n,'scope',coalesce(i->'scope','{}')||jsonb_build_object('_materialization_order',ordering)))).*;
 else
 -- Occurrence, original acceptance and key order, never retry receipt time.
 update public.operational_incidents t set
 evidence=(select coalesce(jsonb_agg(v order by ord),'[]'::jsonb) from (
   select v,ord from (select distinct on (coalesce(v->>'id',v->>'signal_id',v::text)) v,ord
   from jsonb_array_elements(coalesce(t.evidence,'[]')||coalesce(i->'evidence','[]')) with ordinality q(v,ord)
   order by coalesce(v->>'id',v->>'signal_id',v::text),ord) dedup order by ord desc limit 24) e),
 affected_entities=(select coalesce(jsonb_agg(v),'[]'::jsonb) from (select distinct v from jsonb_array_elements(coalesce(t.affected_entities,'[]')||coalesce(i->'affected_entities','[]')) v limit 24) e),
 status=case when newer then i->>'status' else t.status end,
 title=case when newer then i->>'title' else t.title end,
 confidence=case when newer then (i->>'confidence')::numeric else t.confidence end,
 scope=case when newer then t.scope||jsonb_build_object('_materialization_order',ordering) else t.scope end,
 severity=case when newer then i->>'severity' else t.severity end,
 last_seen_at=case when newer then r.occurred_at else t.last_seen_at end,
 first_seen_at=least(t.first_seen_at,r.occurred_at),
 resolved_at=case when newer then (i->>'resolved_at')::timestamptz else t.resolved_at end,
 current_summary=case when newer then i->>'current_summary' else t.current_summary end,
 updated_at=case when newer then n else t.updated_at end where t.id=v_incident_id;
 end if;
 if newer and i->>'status'='resolved' then
 update public.operational_recommendations set status='resolved',resolved_by=coalesce(r.actor_id,'oyi_core'),updated_at=n,
 outcome=jsonb_build_object('resolved_by_signal',r.payload#>>'{signal,id}')
 where operational_recommendations.incident_id=v_incident_id and status in ('pending','open');
 end if;
 end if;
 for x in select value from jsonb_array_elements(p#>'{rows,awareness}') loop
 if existing.id is not null and not newer and existing.status='resolved' and x->>'status'<>'suppressed' then
 x:=x||jsonb_build_object('status','resolved');
 end if;
 insert into public.operational_awareness select (jsonb_populate_record(null::public.operational_awareness,
 x||jsonb_build_object('incident_id',case when (p->>'suppress_child')::boolean then null else v_incident_id end))).*
 on conflict(awareness_key) do nothing;
 end loop;
 for x in select value from jsonb_array_elements(p#>'{rows,recommendations}') loop
 if existing.id is not null and not newer and existing.status='resolved' and x->>'status' in ('pending','open') then
 x:=x||jsonb_build_object('status','resolved','outcome',jsonb_build_object('materialized_after_incident_recovery',true));
 end if;
 insert into public.operational_recommendations select (jsonb_populate_record(null::public.operational_recommendations,
 x||jsonb_build_object('incident_id',v_incident_id))).* on conflict(recommendation_key) do nothing;
 end loop;
 for x in select value from jsonb_array_elements(p#>'{rows,insights}') loop
 insert into public.operational_insights select (jsonb_populate_record(null::public.operational_insights,
 x||jsonb_build_object('incident_id',v_incident_id))).* on conflict(id) do nothing;
 end loop;
 for x in select value from jsonb_array_elements(p#>'{rows,plans}') loop
 insert into public.operational_plans select (jsonb_populate_record(null::public.operational_plans,x)).* on conflict(id) do nothing;
 end loop;
 for x in select value from jsonb_array_elements(p#>'{rows,deliveries}') loop
 insert into public.operational_delivery_outbox select (jsonb_populate_record(null::public.operational_delivery_outbox,
 x||jsonb_build_object('payload',(x->'payload')||jsonb_build_object('incident_id',v_incident_id)))).* on conflict(delivery_key) do nothing;
 end loop;
 update public.operational_signals set materialization=(materialization-'claim_token')||jsonb_build_object(
 'state','materialized','completed_at',n,'incident_id',v_incident_id) where id=p_signal_id;
 return jsonb_build_object('complete',true,'incident_id',v_incident_id);
end $$;

revoke all on function public.oyi_register_materialization(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.oyi_claim_materialization(integer,uuid) from public,anon,authenticated;
revoke all on function public.oyi_complete_materialization(uuid,uuid) from public,anon,authenticated;
revoke all on function public.oyi_fail_materialization(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.oyi_register_materialization(jsonb,jsonb),public.oyi_claim_materialization(integer,uuid),public.oyi_complete_materialization(uuid,uuid),public.oyi_fail_materialization(uuid,uuid,text,boolean) to service_role;
-- Invoker RPCs require the existing trusted Backend role's underlying table access.
grant select,insert,update on public.operational_signals,public.operational_incidents,
 public.operational_awareness,public.operational_recommendations,public.operational_insights,
 public.operational_plans,public.operational_delivery_outbox to service_role;
