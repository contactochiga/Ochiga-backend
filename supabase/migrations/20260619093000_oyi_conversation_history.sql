-- Oyi Unified Intelligence + Chat Surface V1 conversation history.
-- Safe additive migration: no drops, no destructive updates.

create table if not exists public.oyi_conversation_threads (
  id uuid primary key,
  user_id uuid null,
  surface text not null default 'consumer',
  estate_id uuid null,
  home_id uuid null,
  module text null,
  title text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.oyi_conversation_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.oyi_conversation_threads(id) on delete cascade,
  user_id uuid null,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text not null default '',
  cards jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  suggested_actions jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_oyi_conversation_threads_user_updated on public.oyi_conversation_threads(user_id, updated_at desc);
create index if not exists idx_oyi_conversation_threads_scope on public.oyi_conversation_threads(surface, estate_id, home_id, updated_at desc);
create index if not exists idx_oyi_conversation_messages_thread_created on public.oyi_conversation_messages(thread_id, created_at asc);

alter table public.oyi_conversation_threads enable row level security;
alter table public.oyi_conversation_messages enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'oyi_conversation_threads'
      and policyname = 'oyi_conversation_threads_owner_select'
  ) then
    create policy "oyi_conversation_threads_owner_select"
      on public.oyi_conversation_threads for select
      using (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'oyi_conversation_messages'
      and policyname = 'oyi_conversation_messages_owner_select'
  ) then
    create policy "oyi_conversation_messages_owner_select"
      on public.oyi_conversation_messages for select
      using (
        exists (
          select 1 from public.oyi_conversation_threads t
          where t.id = oyi_conversation_messages.thread_id
          and t.user_id = auth.uid()
        )
      );
  end if;
end $$;
