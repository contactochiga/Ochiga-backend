-- Local Stage4E. Additive recovery ledger; no wallet tables or balances.
create table hardware_payment_observations (
 id bigint generated always as identity primary key, reference text not null references hardware_payment_attempts(reference),
 state text not null check(state in ('provider_pending','pending_overdue','provider_failed','provider_unavailable','provider_success','amount_mismatch','disputed','dispute_review','reversed_unreconciled','office_retry','refund_pending','refund_processed','refund_escalated','refund_uncertain')),
 evidence jsonb not null, fingerprint text not null, created_at timestamptz not null default now(),unique(reference,fingerprint)
);
create table hardware_payment_delivery_queue(event_id bigint primary key references hardware_payment_observations(id),delivered_at timestamptz);
create table hardware_refunds (
 approval_id uuid primary key,reference text not null unique references hardware_payment_attempts(reference),order_id uuid not null unique,
 amount_kobo bigint not null check(amount_kobo>0),requested_by text not null,approved_by text not null check(approved_by<>requested_by),
 state text not null default 'approved' check(state in ('approved','dispatching','uncertain','pending','processed','escalated')),
 provider_refund_id text unique,lease_token uuid,lease_until timestamptz,next_attempt_at timestamptz not null default now(),created_at timestamptz not null default now()
);
create table hardware_refund_events(id bigint generated always as identity primary key,approval_id uuid not null references hardware_refunds(approval_id),event_type text not null,evidence jsonb not null default '{}',created_at timestamptz not null default now());
create function hardware_refund_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$begin
 if tg_op<>'UPDATE' or (to_jsonb(new)-array['state','provider_refund_id','lease_token','lease_until','next_attempt_at']) is distinct from (to_jsonb(old)-array['state','provider_refund_id','lease_token','lease_until','next_attempt_at']) or (old.provider_refund_id is not null and new.provider_refund_id is distinct from old.provider_refund_id) or (old.state='processed' and new.state<>'processed') or (old.state<>'approved' and new.state='approved') then raise exception 'refund_transition_denied';end if;return new;end$$;
create trigger refund_guard before update or delete on hardware_refunds for each row execute function hardware_refund_guard();
do $$declare t text;begin foreach t in array array['hardware_payment_observations','hardware_payment_delivery_queue','hardware_refunds','hardware_refund_events'] loop
 execute format('alter table %I enable row level security',t);execute format('revoke all on %I from public,anon,authenticated,service_role',t);execute format('grant select,insert,update on %I to service_role',t);
 execute format('create trigger recovery_no_truncate before truncate on %I execute function hardware_payment_immutable()',t);
 if t in ('hardware_payment_observations','hardware_refund_events') then execute format('create trigger recovery_immutable before update or delete on %I for each row execute function hardware_payment_immutable()',t);end if;end loop;end$$;
revoke all on sequence hardware_payment_observations_id_seq,hardware_refund_events_id_seq from public,anon,authenticated,service_role;
grant usage,select on sequence hardware_payment_observations_id_seq,hardware_refund_events_id_seq to service_role;
create function hardware_recovery_observe(p_reference text,p_state text,p_evidence jsonb) returns bigint language plpgsql set search_path=public,pg_temp as $$declare eid bigint;h text;begin
 h:=encode(sha256(convert_to(p_state||':'||p_evidence::text,'UTF8')),'hex');
 insert into hardware_payment_observations(reference,state,evidence,fingerprint) values(p_reference,p_state,p_evidence,h) on conflict do nothing returning id into eid;
 if eid is null then select id into eid from hardware_payment_observations where reference=p_reference and fingerprint=h;end if;
 insert into hardware_payment_delivery_queue values(eid,null) on conflict do nothing;return eid;end$$;
create function hardware_recovery_claim(p_reference text) returns jsonb language plpgsql set search_path=public,pg_temp as $$declare a hardware_payment_attempts%rowtype;begin
 update hardware_payment_attempts set lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',attempts=attempts+1 where reference=p_reference and (lease_until is null or lease_until<clock_timestamp()) returning * into a;
 if a.reference is null then return null;end if;insert into hardware_payment_events(reference,event_type) values(a.reference,'recovery_claimed');return to_jsonb(a);end$$;
create function hardware_recovery_release(p_reference text,p_token uuid) returns void language sql set search_path=public,pg_temp as $$
 update hardware_payment_attempts set next_attempt_at=clock_timestamp()+make_interval(secs=>case when state in ('confirmed','refund_required','manual_reconciliation') then 3600 else least(900,60*power(2,least(attempts,4)))::integer end),lease_until=null,lease_token=null where reference=p_reference and lease_token=p_token$$;
create function hardware_refund_create(p jsonb) returns jsonb language plpgsql set search_path=public,pg_temp as $$declare a hardware_payment_attempts%rowtype;r hardware_refunds%rowtype;begin
 select * into a from hardware_payment_attempts where reference=p->>'reference' for update;
 if not found or a.proof is null or a.state not in ('confirmed','refund_required') or a.order_id::text is distinct from p->>'order_id' or a.amount_kobo::text is distinct from p->>'amount_kobo' or a.environment<>'test' then raise exception 'refund_not_eligible';end if;
 select * into r from hardware_refunds where reference=a.reference;
 if found then if r.approval_id::text<>p->>'approval_id' or r.requested_by is distinct from p->>'requested_by' or r.approved_by is distinct from p->>'approved_by' then raise exception 'refund_conflict';end if;return to_jsonb(r);end if;
 insert into hardware_refunds(approval_id,reference,order_id,amount_kobo,requested_by,approved_by) values((p->>'approval_id')::uuid,a.reference,a.order_id,a.amount_kobo,p->>'requested_by',p->>'approved_by') returning * into r;
 insert into hardware_refund_events(approval_id,event_type) values(r.approval_id,'approved');return to_jsonb(r);end$$;
create function hardware_refund_claim(p_id uuid) returns jsonb language plpgsql set search_path=public,pg_temp as $$declare r hardware_refunds%rowtype;begin
 update hardware_refunds set lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds' where approval_id=p_id and state<>'processed' and (lease_until is null or lease_until<clock_timestamp()) returning * into r;
 return case when r.approval_id is null then null else to_jsonb(r) end;end$$;
create function hardware_refund_record(p_id uuid,p_token uuid,p_state text,p_evidence jsonb) returns void language plpgsql set search_path=public,pg_temp as $$declare r hardware_refunds%rowtype;a hardware_payment_attempts%rowtype;begin
 select * into r from hardware_refunds where approval_id=p_id for update;select * into a from hardware_payment_attempts where reference=r.reference;
 if r.lease_token is distinct from p_token or r.lease_until<clock_timestamp() then raise exception 'refund_lease_lost';end if;
 if p_state='dispatching' and r.state<>'approved' then raise exception 'refund_already_dispatched';end if;
 if p_state='processed' and (p_evidence->>'status' is distinct from 'processed' or p_evidence->>'amount_kobo' is distinct from r.amount_kobo::text or p_evidence->>'currency' is distinct from 'NGN' or p_evidence->>'environment' is distinct from 'test' or p_evidence->>'transaction_id' is distinct from a.provider_id or coalesce(p_evidence->>'refund_id','') !~ '^[0-9]+$') then raise exception 'verified_refund_required';end if;
 update hardware_refunds set state=p_state,provider_refund_id=coalesce(p_evidence->>'refund_id',provider_refund_id) where approval_id=p_id;
 insert into hardware_refund_events(approval_id,event_type,evidence) values(p_id,p_state,p_evidence);
 if p_state in ('pending','processed','escalated','uncertain') then perform hardware_recovery_observe(r.reference,'refund_'||p_state,p_evidence||jsonb_build_object('approval_id',p_id));end if;end$$;
create function hardware_refund_release(p_id uuid,p_token uuid) returns void language sql set search_path=public,pg_temp as $$update hardware_refunds set lease_token=null,lease_until=null,next_attempt_at=clock_timestamp()+interval '5 minutes' where approval_id=p_id and lease_token=p_token$$;
create function hardware_recovery_ack(p_id bigint) returns void language sql set search_path=public,pg_temp as $$update hardware_payment_delivery_queue set delivered_at=coalesce(delivered_at,clock_timestamp()) where event_id=p_id$$;
do $$declare f regprocedure;begin for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and (proname like 'hardware_recovery_%' or proname like 'hardware_refund_%') loop execute format('revoke all on function %s from public,anon,authenticated',f);execute format('grant execute on function %s to service_role',f);end loop;end$$;
