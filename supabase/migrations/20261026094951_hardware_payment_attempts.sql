-- Stage 4D LOCAL ONLY. Independent of wallet ledgers. Execute transactionally.
create table hardware_payment_attempts (
 reference text primary key check(reference ~ '^hwo_[0-9a-f]{32}$'),
 order_id uuid not null unique, reservation_id uuid not null,
 amount_kobo bigint not null check(amount_kobo between 1 and 900999999999),
 currency text not null check(currency='NGN'), environment text not null check(environment='test'),
 authorization_hash text not null check(authorization_hash ~ '^[0-9a-f]{64}$'),
 state text not null default 'created' check(state in ('created','initializing','pending','uncertain','verified','confirmed','manual_reconciliation','refund_required')),
 checkout_url text, provider_id text unique, proof jsonb,
 lease_token uuid, lease_until timestamptz, attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table hardware_payment_events (
 id bigint generated always as identity primary key, reference text not null references hardware_payment_attempts(reference),
 event_type text not null, detail jsonb not null default '{}', created_at timestamptz not null default now()
);
create table hardware_payment_inbox (
 digest text primary key check(digest ~ '^[0-9a-f]{64}$'), reference text not null,
 event_type text not null, known_reference boolean not null, created_at timestamptz not null default now()
);
create function hardware_payment_immutable() returns trigger language plpgsql set search_path=public,pg_temp as $$begin raise exception 'payment_history_immutable';end$$;
create function hardware_payment_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$begin
 if tg_op<>'UPDATE' or (to_jsonb(new)-array['state','checkout_url','provider_id','proof','lease_token','lease_until','attempts','next_attempt_at','updated_at']) is distinct from (to_jsonb(old)-array['state','checkout_url','provider_id','proof','lease_token','lease_until','attempts','next_attempt_at','updated_at'])
 or (old.proof is not null and new.proof is distinct from old.proof) or (old.provider_id is not null and new.provider_id is distinct from old.provider_id)
 or (old.state in ('confirmed','refund_required','manual_reconciliation') and new.state<>old.state) then raise exception 'payment_transition_denied';end if;return new;end$$;
create trigger hardware_payment_guard before update or delete on hardware_payment_attempts for each row execute function hardware_payment_guard();
do $$declare t text;begin
 foreach t in array array['hardware_payment_attempts','hardware_payment_events','hardware_payment_inbox'] loop
 execute format('alter table %I enable row level security',t);
 execute format('revoke all on %I from public,anon,authenticated,service_role',t);
 execute format('grant select,insert,update on %I to service_role',t);
 execute format('create trigger payment_no_truncate before truncate on %I execute function hardware_payment_immutable()',t);
 if t<>'hardware_payment_attempts' then execute format('create trigger payment_immutable before update or delete on %I for each row execute function hardware_payment_immutable()',t);end if;
 end loop;
end$$;
revoke all on sequence hardware_payment_events_id_seq from public,anon,authenticated,service_role;
grant usage,select on sequence hardware_payment_events_id_seq to service_role;
create function hardware_payment_create(p jsonb) returns jsonb language plpgsql set search_path=public,pg_temp as $$declare a hardware_payment_attempts%rowtype;begin
 perform pg_advisory_xact_lock(hashtextextended(p->>'order_id',47));
 select * into a from hardware_payment_attempts where order_id=(p->>'order_id')::uuid;
 if found then if a.authorization_hash<>p->>'authorization_hash' or a.reference<>p->>'reference' or a.amount_kobo<>(p->>'amount_kobo')::bigint or a.reservation_id<>(p->>'reservation_id')::uuid then raise exception 'payment_idempotency_conflict';end if;return to_jsonb(a);end if;
 insert into hardware_payment_attempts(reference,order_id,reservation_id,amount_kobo,currency,environment,authorization_hash)
 values(p->>'reference',(p->>'order_id')::uuid,(p->>'reservation_id')::uuid,(p->>'amount_kobo')::bigint,p->>'currency',p->>'environment',p->>'authorization_hash') returning * into a;
 insert into hardware_payment_events(reference,event_type) values(a.reference,'created');return to_jsonb(a);end$$;
create function hardware_payment_claim(p_reference text) returns jsonb language plpgsql set search_path=public,pg_temp as $$declare a hardware_payment_attempts%rowtype;begin
 update hardware_payment_attempts set lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',attempts=attempts+1,updated_at=clock_timestamp()
 where reference=p_reference and (lease_until is null or lease_until<clock_timestamp()) and state not in ('confirmed','refund_required','manual_reconciliation') returning * into a;
 if a.reference is not null then insert into hardware_payment_events(reference,event_type,detail) values(a.reference,'processing_claimed',jsonb_build_object('attempt',a.attempts));end if;
 return case when a.reference is null then null else to_jsonb(a) end;end$$;
create function hardware_payment_record(p_reference text,p_token uuid,p_state text,p_detail jsonb) returns jsonb language plpgsql set search_path=public,pg_temp as $$declare a hardware_payment_attempts%rowtype;begin
 select * into a from hardware_payment_attempts where reference=p_reference for update;
 if not found or a.lease_token is distinct from p_token or a.lease_until<clock_timestamp() then raise exception 'payment_lease_lost';end if;
 if p_state not in ('initializing','pending','uncertain','verified','confirmed','manual_reconciliation','refund_required') then raise exception 'invalid_payment_state';end if;
 if p_state='verified' and (p_detail->>'reference' is distinct from a.reference or p_detail->>'order_id' is distinct from a.order_id::text or p_detail->>'reservation_id' is distinct from a.reservation_id::text or p_detail->>'amount_kobo' is distinct from a.amount_kobo::text or p_detail->>'currency' is distinct from 'NGN' or p_detail->>'environment' is distinct from a.environment or p_detail->>'purpose' is distinct from 'hardware_order' or coalesce(p_detail->>'provider_id','') !~ '^[0-9]+$') then raise exception 'invalid_payment_proof';end if;
 if p_state in ('confirmed','refund_required') and a.state<>'verified' then raise exception 'verification_required';end if;
 if a.state='verified' and p_state not in ('verified','confirmed','refund_required') then raise exception 'verification_downgrade_denied';end if;
 update hardware_payment_attempts set state=p_state,
 checkout_url=coalesce(p_detail->>'checkout_url',checkout_url),
 proof=case when p_state='verified' then p_detail else proof end,
 provider_id=case when p_state='verified' then p_detail->>'provider_id' else provider_id end,
 updated_at=clock_timestamp(),next_attempt_at=clock_timestamp()+interval '60 seconds' where reference=p_reference returning * into a;
 insert into hardware_payment_events(reference,event_type,detail) values(p_reference,p_state,p_detail-array['checkout_url']);return to_jsonb(a);end$$;
create function hardware_payment_unlock(p_reference text,p_token uuid) returns void language sql set search_path=public,pg_temp as $$update hardware_payment_attempts set lease_until=null,lease_token=null where reference=p_reference and lease_token=p_token$$;
create function hardware_payment_accept_event(p_digest text,p_reference text,p_type text) returns void language plpgsql set search_path=public,pg_temp as $$begin
 insert into hardware_payment_inbox values(p_digest,left(p_reference,100),left(p_type,80),exists(select 1 from hardware_payment_attempts where reference=p_reference),clock_timestamp()) on conflict do nothing;
 update hardware_payment_attempts set next_attempt_at=clock_timestamp() where reference=p_reference;
end$$;
create function hardware_payment_note(p_reference text,p_token uuid,p_event text) returns void language plpgsql set search_path=public,pg_temp as $$begin
 if p_event not in ('office_delivery_failed','provider_verify_unavailable','provider_not_successful') or not exists(select 1 from hardware_payment_attempts where reference=p_reference and lease_token=p_token and lease_until>clock_timestamp()) then raise exception 'payment_note_denied';end if;
 insert into hardware_payment_events(reference,event_type) values(p_reference,p_event);
end$$;
do $$declare f regprocedure;begin
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname like 'hardware_payment_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f);execute format('grant execute on function %s to service_role',f);end loop;end$$;
