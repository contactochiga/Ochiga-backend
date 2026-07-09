begin;

create table if not exists service_transactions (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid references estates(id) on delete set null,
  home_id uuid references homes(id) on delete set null,
  resident_id uuid references users(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  service_account_id uuid references home_service_accounts(id) on delete set null,
  service_type text not null,
  service_key text not null,
  provider text,
  amount numeric not null default 0,
  currency text not null default 'NGN',
  status text not null default 'pending',
  transaction_type text not null,
  settlement_status text not null default 'none',
  provider_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_transactions_status_check check (status in ('pending','pending_provider','manual_review','unsupported','completed','failed','cancelled')),
  constraint service_transactions_settlement_check check (settlement_status in ('none','pending','queued','in_progress','settled','failed','unsupported'))
);

create index if not exists idx_service_transactions_estate on service_transactions(estate_id, created_at desc);
create index if not exists idx_service_transactions_home on service_transactions(home_id, created_at desc);
create index if not exists idx_service_transactions_user on service_transactions(user_id, created_at desc);
create index if not exists idx_service_transactions_account on service_transactions(service_account_id, created_at desc);
create index if not exists idx_service_transactions_key on service_transactions(service_key, created_at desc);

alter table if exists service_registry_events
  drop constraint if exists service_registry_events_type_check;

alter table if exists service_registry_events
  add constraint service_registry_events_type_check
  check (
    event_type in (
      'service.config.updated',
      'home.service_registry.updated',
      'home.utility_account.updated',
      'wallet.service_payment.updated',
      'service.account.provisioned',
      'service.assignment.created',
      'service.status.changed',
      'service.vending.ready',
      'service.transaction.initiated',
      'service.transaction.failed',
      'service.issue.reported'
    )
  );

commit;
