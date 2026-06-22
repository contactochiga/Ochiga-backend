begin;

alter table public.notifications
  add column if not exists resolution_note text;

create table if not exists public.facility_shift_handovers (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid not null,
  handover_date date not null default current_date,
  author_id uuid not null,
  summary text,
  open_items jsonb not null default '[]'::jsonb,
  handover_items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists facility_shift_handovers_estate_date_author_idx on public.facility_shift_handovers(estate_id, handover_date, author_id);
alter table public.facility_shift_handovers enable row level security;
revoke all on table public.facility_shift_handovers from anon, authenticated;

commit;
