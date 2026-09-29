-- Wave 9 production-schema compatibility overlay.
--
-- This file is intentionally NOT a historical migration and MUST NOT be run
-- against a populated production database. It is the final, additive (except
-- for the guarded empty-table replacement below) step of the documented fresh
-- installation sequence:
--   platform auth/storage schemas -> migrations/schema.sql -> retained May
--   foundation -> verified-production-prerequisites.sql -> tracked migrations
--   -> this compatibility overlay.
--
-- Every definition below was read from the schema-only dump of linked project
-- zcpgtdakqxyvjkmiibei on 2026-09-28. Historical creator migrations remain
-- unknown; this records current verified production truth only.

create table if not exists public.room_device_bindings (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid not null,
  home_id uuid not null,
  room_id uuid not null references public.rooms(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  binding_type text not null check (binding_type in ('light', 'ac', 'tv', 'plug', 'switch')),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (room_id, binding_type)
);

create index if not exists idx_rdb_room on public.room_device_bindings(room_id);
create index if not exists idx_rdb_device on public.room_device_bindings(device_id);

-- The old foundation's empty visitors table is not part of verified production:
-- production exposes a compatibility view over visitor_access. Refuse to
-- replace a populated table, so this cannot discard data if misused.
do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'visitors' and c.relkind = 'r'
  ) then
    if exists (select 1 from public.visitors limit 1) then
      raise exception 'verified production compatibility overlay refuses to replace populated public.visitors';
    end if;
    drop table public.visitors;
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.visitors_legacy'::regclass
      and conname = 'visitors_legacy_pkey'
  ) and not exists (select 1 from pg_constraint where conname = 'visitors_pkey') then
    alter table public.visitors_legacy rename constraint visitors_legacy_pkey to visitors_pkey;
  end if;
end;
$$;

create or replace view public.visitors as
  select id, estate_id, home_id, created_by, visitor_name, visitor_phone,
    purpose, access_code, status, expires_at, created_at, house_id,
    navigation_mode, resident_id
  from public.visitor_access;

create index if not exists idx_visitors_estate on public.visitors_legacy(estate_id);

-- Current production retains this legacy timestamp alongside occurred_at;
-- the retained tracked definition only creates occurred_at.
alter table public.ochiga_agent_observability
  add column if not exists created_at timestamptz default now();

alter table public.ochiga_memory_directory
  add column if not exists memory_scope text,
  add column if not exists scope_id text;

alter table public.room_assignments
  add column if not exists resident_id uuid;

create unique index if not exists devices_estate_vendor_external_unique on public.devices(estate_id, vendor, external_id);
create unique index if not exists devices_vendor_external_id_uniq on public.devices(vendor, external_id);
create index if not exists idx_community_comments_parent_comment_id on public.community_comments(parent_comment_id);
create index if not exists idx_community_live_sessions_estate_id on public.community_live_sessions(estate_id);
create index if not exists idx_community_live_sessions_status on public.community_live_sessions(status);
create index if not exists idx_community_reactions_comment_id on public.community_reactions(comment_id);
create index if not exists idx_community_reactions_post_id on public.community_reactions(post_id);
create index if not exists idx_community_reactions_user_id on public.community_reactions(user_id);
create index if not exists idx_estate_service_configs_estate_id on public.estate_service_configs(estate_id);
create index if not exists idx_maintenance_resident on public.maintenance_requests(resident_id);
create index if not exists idx_notifications_user_status_created on public.notifications(user_id, status, created_at desc);
create index if not exists idx_oao_agent on public.ochiga_agent_observability(agent_id);
create index if not exists idx_oao_created on public.ochiga_agent_observability(created_at desc);
create index if not exists idx_oie_created on public.ochiga_intelligence_events(created_at desc);
create index if not exists idx_oie_estate on public.ochiga_intelligence_events(estate_id);
create index if not exists idx_oie_home on public.ochiga_intelligence_events(home_id);
create index if not exists idx_oip_estate on public.ochiga_intelligence_predictions(estate_id);
create index if not exists idx_oip_home on public.ochiga_intelligence_predictions(home_id);
create index if not exists idx_oip_status on public.ochiga_intelligence_predictions(status);
create index if not exists idx_oip_type on public.ochiga_intelligence_predictions(prediction_type);
create index if not exists idx_omd_scope on public.ochiga_memory_directory(memory_scope);
create index if not exists idx_room_assignments_resident on public.room_assignments(resident_id);
create index if not exists idx_room_rules_enabled on public.room_rules(enabled);
create index if not exists idx_suggestions_device on public.suggestions(device_id);
create index if not exists idx_suggestions_status on public.suggestions(status);
create unique index if not exists uniq_invites_pending_home_email on public.invites(home_id, lower(invited_email)) where status = 'pending';
create unique index if not exists uq_invites_token on public.invites(token_hash);
create index if not exists wallet_transactions_estate_created_idx on public.wallet_transactions(estate_id, created_at desc);
create index if not exists wallet_transactions_user_created_idx on public.wallet_transactions(user_id, created_at desc);

drop trigger if exists trg_community_comments_updated_at on public.community_comments;
create trigger trg_community_comments_updated_at before update on public.community_comments for each row execute function public.set_updated_at();
drop trigger if exists trg_community_reactions_updated_at on public.community_reactions;
create trigger trg_community_reactions_updated_at before update on public.community_reactions for each row execute function public.set_updated_at();
drop trigger if exists trg_estate_memberships_updated_at on public.estate_memberships;
create trigger trg_estate_memberships_updated_at before update on public.estate_memberships for each row execute function public.touch_updated_at();
drop trigger if exists trg_estate_service_configs_updated_at on public.estate_service_configs;
create trigger trg_estate_service_configs_updated_at before update on public.estate_service_configs for each row execute function public.set_updated_at();
drop trigger if exists trg_estates_updated_at on public.estates;
create trigger trg_estates_updated_at before update on public.estates for each row execute function public.set_updated_at();
drop trigger if exists trg_home_memberships_updated_at on public.home_memberships;
create trigger trg_home_memberships_updated_at before update on public.home_memberships for each row execute function public.touch_updated_at();
drop trigger if exists trg_invites_notify_created on public.invites;
create trigger trg_invites_notify_created after insert on public.invites for each row execute function public.notify_invite_created();
drop trigger if exists trg_invites_updated_at on public.invites;
create trigger trg_invites_updated_at before update on public.invites for each row execute function public.touch_updated_at();
drop trigger if exists trg_notifications_updated_at on public.notifications;
create trigger trg_notifications_updated_at before update on public.notifications for each row execute function public.touch_updated_at();
drop trigger if exists trg_notify_invite_created on public.invites;
create trigger trg_notify_invite_created after insert on public.invites for each row when (new.status = 'pending') execute function public.notify_invite_created();
drop trigger if exists trg_sync_house_id on public.visitor_access;
create trigger trg_sync_house_id before insert or update on public.visitor_access for each row execute function public.sync_house_id();
drop trigger if exists trg_user_presence_updated_at on public.user_presence;
create trigger trg_user_presence_updated_at before update on public.user_presence for each row execute function public.set_updated_at();
drop trigger if exists trg_user_push_tokens_updated_at on public.user_push_tokens;
create trigger trg_user_push_tokens_updated_at before update on public.user_push_tokens for each row execute function public.set_updated_at();
drop trigger if exists trg_users_updated_at on public.users;
create trigger trg_users_updated_at before update on public.users for each row execute function public.set_updated_at();
drop trigger if exists trg_wallet_transactions_updated_at on public.wallet_transactions;
create trigger trg_wallet_transactions_updated_at before update on public.wallet_transactions for each row execute function public.touch_updated_at();
drop trigger if exists trg_wallets_updated_at on public.wallets;
create trigger trg_wallets_updated_at before update on public.wallets for each row execute function public.touch_updated_at();

drop policy if exists community_comments_insert_auth on public.community_comments;
create policy community_comments_insert_auth on public.community_comments for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists community_reactions_insert_auth on public.community_reactions;
create policy community_reactions_insert_auth on public.community_reactions for insert to authenticated with check (auth.uid() = user_id);
