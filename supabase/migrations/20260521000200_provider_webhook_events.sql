-- Provider webhook event delivery records for Office production readiness.

create table if not exists provider_webhook_events (
  id uuid default gen_random_uuid() primary key,
  provider text not null,
  event_type text not null,
  received_at timestamptz not null default now(),
  verified boolean not null default false,
  signature_status text not null default 'unknown',
  delivery_status text not null default 'received',
  error_message text not null default '',
  payload_summary jsonb not null default '{}'::jsonb,
  related_estate_id text,
  related_user_id text,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_provider_webhook_events_received
  on provider_webhook_events(received_at desc);

create index if not exists idx_provider_webhook_events_provider
  on provider_webhook_events(provider, event_type, received_at desc);

create index if not exists idx_provider_webhook_events_delivery
  on provider_webhook_events(delivery_status, received_at desc);

create index if not exists idx_provider_webhook_events_estate
  on provider_webhook_events(related_estate_id, received_at desc);
