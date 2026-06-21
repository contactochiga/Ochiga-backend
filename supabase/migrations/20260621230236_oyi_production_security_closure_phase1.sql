-- Oyi Production Security Closure Phase 1
-- Additive hardening only. Backend service_role access remains unchanged.

begin;

-- Public tables are backend-owned. Deny direct Data API access by default and
-- keep RLS enabled as defence in depth for future authenticated access.
do $$
declare
  table_name text;
begin
  for table_name in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
  end loop;
end $$;

-- The legacy SECURITY DEFINER visitors view must not be directly queryable.
do $$
begin
  if to_regclass('public.visitors') is not null then
    revoke all on table public.visitors from anon, authenticated;
  end if;
end $$;

-- Membership tables: users may only inspect their own active membership rows.
drop policy if exists oyi_estate_memberships_self_select on public.estate_memberships;
create policy oyi_estate_memberships_self_select
  on public.estate_memberships for select to authenticated
  using (user_id = auth.uid());

drop policy if exists oyi_home_memberships_self_select on public.home_memberships;
create policy oyi_home_memberships_self_select
  on public.home_memberships for select to authenticated
  using (user_id = auth.uid());

-- User-owned records.
drop policy if exists oyi_users_self_select on public.users;
create policy oyi_users_self_select on public.users for select to authenticated using (id = auth.uid());

drop policy if exists oyi_users_self_update on public.users;
create policy oyi_users_self_update on public.users for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists oyi_wallets_owner_select on public.wallets;
create policy oyi_wallets_owner_select on public.wallets for select to authenticated using (user_id = auth.uid());

drop policy if exists oyi_wallet_transactions_owner_select on public.wallet_transactions;
create policy oyi_wallet_transactions_owner_select on public.wallet_transactions for select to authenticated using (user_id = auth.uid());

drop policy if exists oyi_notifications_owner_select on public.notifications;
create policy oyi_notifications_owner_select on public.notifications for select to authenticated using (user_id = auth.uid());

drop policy if exists oyi_notifications_owner_update on public.notifications;
create policy oyi_notifications_owner_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists oyi_notification_preferences_owner_all on public.user_notification_preferences;
create policy oyi_notification_preferences_owner_all on public.user_notification_preferences for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists oyi_push_tokens_owner_all on public.user_push_tokens;
create policy oyi_push_tokens_owner_all on public.user_push_tokens for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists oyi_resident_memory_owner_all on public.resident_memory;
create policy oyi_resident_memory_owner_all on public.resident_memory for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists oyi_proximity_settings_owner_all on public.resident_proximity_settings;
create policy oyi_proximity_settings_owner_all on public.resident_proximity_settings for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Home records: residents require an active home membership; estate operators
-- require an active operator membership in the record estate.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'rooms', 'devices', 'device_events', 'device_runtime_sessions',
    'device_usage_counters', 'visitor_access', 'maintenance_requests',
    'home_service_accounts', 'home_service_assignments', 'home_timeline',
    'consumer_scenes', 'consumer_automations', 'service_provider_transactions',
    'service_registry_events', 'utility_events', 'utility_telemetry',
    'facility_incidents', 'twin_entity_placements', 'platform_files'
  ]
  loop
    if to_regclass('public.' || table_name) is not null then
      execute format('drop policy if exists %I on public.%I', 'oyi_' || table_name || '_home_or_operator_select', table_name);
      execute format($policy$
        create policy %1$I on public.%2$I for select to authenticated using (
          (home_id is not null and exists (
            select 1 from public.home_memberships hm
            where hm.home_id::text = %2$I.home_id::text and hm.user_id = auth.uid() and coalesce(hm.status, 'active') = 'active'
          ))
          or exists (
            select 1 from public.estate_memberships em
            where em.estate_id::text = %2$I.estate_id::text and em.user_id = auth.uid()
              and coalesce(em.status, 'active') = 'active'
              and lower(coalesce(em.role::text, '')) in ('owner','admin','manager','estate_admin','facility_manager','security','security_operator','maintenance_operator','finance_operator')
          )
        )
      $policy$, 'oyi_' || table_name || '_home_or_operator_select', table_name);
    end if;
  end loop;
end $$;

-- Estate-wide operational records: direct reads are for active operators only.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'estate_service_configs', 'facility_cameras', 'camera_events',
    'camera_infrastructure', 'camera_health_history', 'edge_nodes', 'edge_heartbeats',
    'edge_node_history', 'access_points', 'facility_incident_timeline',
    'discovered_devices', 'service_registry_events', 'ochiga_intelligence_events',
    'ochiga_intelligence_predictions', 'ochiga_workflows', 'ochiga_agent_collaborations',
    'ochiga_agent_observability', 'twin_models'
  ]
  loop
    if to_regclass('public.' || table_name) is not null then
      execute format('drop policy if exists %I on public.%I', 'oyi_' || table_name || '_estate_operator_select', table_name);
      execute format($policy$
        create policy %1$I on public.%2$I for select to authenticated using (
          exists (
            select 1 from public.estate_memberships em
            where em.estate_id::text = %2$I.estate_id::text and em.user_id = auth.uid()
              and coalesce(em.status, 'active') = 'active'
              and lower(coalesce(em.role::text, '')) in ('owner','admin','manager','estate_admin','facility_manager','security','security_operator','maintenance_operator','finance_operator')
          )
        )
      $policy$, 'oyi_' || table_name || '_estate_operator_select', table_name);
    end if;
  end loop;
end $$;

drop policy if exists oyi_homes_member_or_operator_select on public.homes;
create policy oyi_homes_member_or_operator_select on public.homes for select to authenticated using (
  exists (select 1 from public.home_memberships hm where hm.home_id = homes.id and hm.user_id = auth.uid() and coalesce(hm.status, 'active') = 'active')
  or exists (
    select 1 from public.estate_memberships em
    where em.estate_id = homes.estate_id and em.user_id = auth.uid() and coalesce(em.status, 'active') = 'active'
      and lower(coalesce(em.role::text, '')) in ('owner','admin','manager','estate_admin','facility_manager','security','security_operator','maintenance_operator','finance_operator')
  )
);

drop policy if exists oyi_estates_operator_select on public.estates;
create policy oyi_estates_operator_select on public.estates for select to authenticated using (
  exists (
    select 1 from public.estate_memberships em
    where em.estate_id = estates.id and em.user_id = auth.uid() and coalesce(em.status, 'active') = 'active'
      and lower(coalesce(em.role::text, '')) in ('owner','admin','manager','estate_admin','facility_manager','security','security_operator','maintenance_operator','finance_operator')
  )
);

-- Community post visibility is estate membership based. Comments/reactions are
-- constrained through their parent post instead of the unsafe USING (true) rules.
drop policy if exists oyi_community_posts_estate_select on public.community_posts;
create policy oyi_community_posts_estate_select on public.community_posts for select to authenticated using (
  exists (select 1 from public.estate_memberships em where em.estate_id = community_posts.estate_id and em.user_id = auth.uid() and coalesce(em.status, 'active') = 'active')
);

drop policy if exists community_comments_select_auth on public.community_comments;
drop policy if exists oyi_community_comments_estate_select on public.community_comments;
create policy oyi_community_comments_estate_select on public.community_comments for select to authenticated using (
  exists (
    select 1 from public.community_posts post
    join public.estate_memberships em on em.estate_id = post.estate_id
    where post.id = community_comments.post_id and em.user_id = auth.uid() and coalesce(em.status, 'active') = 'active'
  )
);

drop policy if exists community_reactions_select_auth on public.community_reactions;
drop policy if exists oyi_community_reactions_estate_select on public.community_reactions;
create policy oyi_community_reactions_estate_select on public.community_reactions for select to authenticated using (
  exists (
    select 1 from public.community_posts post
    join public.estate_memberships em on em.estate_id = post.estate_id
    where post.id = community_reactions.post_id and em.user_id = auth.uid() and coalesce(em.status, 'active') = 'active'
  )
);

-- Conversation rows remain strictly owner-scoped. Backend service_role persists them.
drop policy if exists oyi_conversation_threads_owner_select on public.oyi_conversation_threads;
create policy oyi_conversation_threads_owner_select on public.oyi_conversation_threads for select to authenticated using (user_id = auth.uid());

drop policy if exists oyi_conversation_messages_owner_select on public.oyi_conversation_messages;
create policy oyi_conversation_messages_owner_select on public.oyi_conversation_messages for select to authenticated using (
  exists (select 1 from public.oyi_conversation_threads t where t.id = oyi_conversation_messages.thread_id and t.user_id = auth.uid())
);

commit;
