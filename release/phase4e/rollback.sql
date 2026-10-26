-- PRE-USE rollback only. Once any financial facts exist retain schema and roll application forward.
begin;
do $$begin if exists(select 1 from hardware_payment_delivery_queue) or exists(select 1 from hardware_payment_observations) or exists(select 1 from hardware_refund_events) or exists(select 1 from hardware_refunds) then raise exception 'financial_records_exist_retain_schema';end if;end$$;
drop table hardware_payment_delivery_queue;
drop table hardware_payment_observations;
drop table hardware_refund_events;
drop table hardware_refunds;
do $$declare f regprocedure;begin for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and (proname like 'hardware_recovery_%' or proname like 'hardware_refund_%') loop execute format('drop function %s',f);end loop;end$$;
commit;
