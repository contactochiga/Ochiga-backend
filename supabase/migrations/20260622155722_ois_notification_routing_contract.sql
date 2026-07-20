begin;

alter table public.notifications
  add column if not exists estate_id uuid references public.estates(id) on delete set null,
  add column if not exists source_type text,
  add column if not exists source_id text,
  add column if not exists destination text,
  add column if not exists target jsonb,
  add column if not exists actionability text,
  add column if not exists attention_eligible boolean,
  add column if not exists queue_eligible boolean,
  add column if not exists acknowledgement_required boolean;

create index if not exists idx_notifications_source
  on public.notifications(source_type, source_id, created_at desc)
  where source_type is not null;

create index if not exists idx_notifications_attention
  on public.notifications(estate_id, created_at desc)
  where attention_eligible is true;

create index if not exists idx_notifications_queue
  on public.notifications(estate_id, created_at desc)
  where queue_eligible is true;

commit;
