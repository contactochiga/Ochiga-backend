-- Wave 11 isolated behavioural fixture.  This is synthetic test data only.
-- It is intentionally not in supabase/migrations and must never be applied
-- to a linked/remote project.

begin;

insert into public.estates (id, name, address, type, status, timezone)
values ('10000000-0000-4000-8000-000000000001', 'Wave 11 Test Estate', 'Synthetic local fixture', 'estate', 'active', 'Africa/Lagos')
on conflict (id) do update set name = excluded.name;

insert into public.users (id, email, full_name, role, estate_id, home_id, permission_scopes)
values
  ('30000000-0000-4000-8000-000000000001', 'resident.a@wave11.local', 'Wave11 Resident A', 'resident', '10000000-0000-4000-8000-000000000001', null, array['devices.read','devices.control','wallet.read','wallets.read','utilities.read','services.read','homes.read','maintenance.read','visitors.read','security.read','community.read','automations.read','scenes.read']),
  ('30000000-0000-4000-8000-000000000002', 'resident.b@wave11.local', 'Wave11 Resident B', 'resident', '10000000-0000-4000-8000-000000000001', null, array['devices.read','wallet.read','homes.read']),
  ('30000000-0000-4000-8000-000000000003', 'facility.manager@wave11.local', 'Wave11 Facility Manager', 'facility_manager', '10000000-0000-4000-8000-000000000001', null, array['devices.read','homes.read','maintenance.read','visitors.read','security.read','utilities.read','services.read','community.read','cameras.view']),
  ('30000000-0000-4000-8000-000000000004', 'facility.staff@wave11.local', 'Wave11 Facility Staff', 'staff', '10000000-0000-4000-8000-000000000001', null, array['maintenance.read','visitors.read']),
  ('30000000-0000-4000-8000-000000000005', 'office.admin@wave11.local', 'Wave11 Office Admin', 'admin', null, null, array['crm.read','reports.read','reports.write','development.manage','financial.read','tasks.read','meetings.read','support.read','portfolio.read','documents.read','content.read','partnerships.read']),
  ('30000000-0000-4000-8000-000000000006', 'public.osa@wave11.local', 'Wave11 Public Osa', 'guest', null, null, array[]::text[])
on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, permission_scopes = excluded.permission_scopes;

insert into public.homes (id, estate_id, name, unit, block, resident_id, type, canonical_ref)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'A-101', '101', 'Tower A', '30000000-0000-4000-8000-000000000001', 'home', 'wave11:a101'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'A-102', '102', 'Tower A', '30000000-0000-4000-8000-000000000002', 'home', 'wave11:a102'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'B-201', '201', 'Tower B', null, 'home', 'wave11:b201')
on conflict (id) do update set name = excluded.name, resident_id = excluded.resident_id;

update public.users
set home_id = case id
  when '30000000-0000-4000-8000-000000000001'::uuid then '20000000-0000-4000-8000-000000000001'::uuid
  when '30000000-0000-4000-8000-000000000002'::uuid then '20000000-0000-4000-8000-000000000002'::uuid
  else home_id
end
where id in ('30000000-0000-4000-8000-000000000001'::uuid, '30000000-0000-4000-8000-000000000002'::uuid);

insert into public.estate_memberships (id, estate_id, user_id, role, status)
values
  ('31000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'resident', 'active'),
  ('31000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'resident', 'active'),
  ('31000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'facility_manager', 'active'),
  ('31000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000004', 'staff', 'active')
on conflict (id) do nothing;

insert into public.home_memberships (id, home_id, user_id, role, status)
values
  ('32000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'resident', 'active'),
  ('32000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'resident', 'active')
on conflict (id) do nothing;

insert into public.rooms (id, estate_id, home_id, name, type, canonical_ref)
values
  ('21000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Living Room', 'living_room', 'wave11:a101:living'),
  ('21000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Master Bedroom', 'bedroom', 'wave11:a101:master'),
  ('21000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Kitchen', 'kitchen', 'wave11:a101:kitchen'),
  ('21000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Study', 'study', 'wave11:a101:study')
on conflict (id) do update set name = excluded.name;

insert into public.devices (id, estate_id, home_id, room_id, name, type, category, adapter, vendor, external_id, status, online, capabilities, metadata, canonical_ref, owner_user_id, last_seen_at)
values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'Wave11 Living Light', 'light', 'light', 'fixture', 'wave11', 'living-light', 'online', true, '["power"]'::jsonb, '{"fixture":true,"test_safe":true,"switch_1":true}'::jsonb, 'wave11:a101:living-light', '30000000-0000-4000-8000-000000000001', now()),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000002', 'Wave11 Bedroom Light', 'light', 'light', 'fixture', 'wave11', 'bedroom-light', 'offline', false, '["power"]'::jsonb, '{"fixture":true,"test_safe":true,"switch_1":false}'::jsonb, 'wave11:a101:bedroom-light', '30000000-0000-4000-8000-000000000001', now() - interval '3 hours'),
  ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000002', 'Wave11 AC', 'air_conditioner', 'ac', 'fixture', 'wave11', 'master-ac', 'online', true, '["power","temperature"]'::jsonb, '{"fixture":true,"test_safe":true,"switch_1":true}'::jsonb, 'wave11:a101:ac', '30000000-0000-4000-8000-000000000001', now() - interval '2 hours'),
  ('40000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000003', 'Wave11 Kitchen Light', 'light', 'light', 'fixture', 'wave11', 'kitchen-light', 'online', true, '["power"]'::jsonb, '{"fixture":true,"test_safe":true,"switch_1":true}'::jsonb, 'wave11:a101:kitchen-light', '30000000-0000-4000-8000-000000000001', now())
on conflict (id) do update set status = excluded.status, online = excluded.online, metadata = excluded.metadata;

insert into public.device_states (device_id, status, last_seen, updated_at)
values
  ('40000000-0000-4000-8000-000000000001', '{"online":true,"switch_1":true,"normalized_state":{"online":true,"power":true}}'::jsonb, now(), now()),
  ('40000000-0000-4000-8000-000000000002', '{"online":false,"switch_1":false,"normalized_state":{"online":false,"power":false}}'::jsonb, now() - interval '3 hours', now() - interval '3 hours'),
  ('40000000-0000-4000-8000-000000000003', '{"online":true,"switch_1":true,"normalized_state":{"online":true,"power":true}}'::jsonb, now() - interval '2 hours', now() - interval '2 hours'),
  ('40000000-0000-4000-8000-000000000004', '{"online":true,"switch_1":true,"normalized_state":{"online":true,"power":true}}'::jsonb, now(), now())
on conflict (device_id) do update set status = excluded.status, last_seen = excluded.last_seen, updated_at = excluded.updated_at;

insert into public.facility_cameras (id, estate_id, home_id, camera_id, name, location, status, stream_status, health_status, privacy_scope, metadata, last_seen_at)
values ('41000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'wave11-camera-1', 'Wave11 Test Camera', 'Tower A Lobby', 'offline', 'offline', 'offline', 'estate_operational', '{"fixture":true}'::jsonb, now() - interval '4 hours')
on conflict (id) do update set status = excluded.status, stream_status = excluded.stream_status;

insert into public.maintenance_requests (id, estate_id, home_id, room_id, user_id, resident_id, title, description, status, priority, category, created_at)
values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Wave11 unresolved water issue', 'Synthetic fixture water leak', 'open', 'high', 'plumbing', now() - interval '2 days'),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Wave11 resolved light issue', 'Synthetic resolved request', 'resolved', 'low', 'electrical', now() - interval '7 days')
on conflict (id) do update set status = excluded.status;

insert into public.visitor_access (id, estate_id, home_id, created_by, resident_id, visitor_name, visitor_phone, purpose, access_code, status, expires_at, created_at)
values
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Wave11 Expected Visitor', '+234000000001', 'fixture meeting', 'W11-EXPECTED', 'active', now() + interval '1 day', now()),
  ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Wave11 Historical Visitor', '+234000000002', 'fixture history', 'W11-HISTORY', 'expired', now() - interval '1 day', now() - interval '2 days')
on conflict (id) do update set status = excluded.status;

insert into public.wallets (id, user_id, estate_id, home_id, membership_id, balance, currency, metadata)
values ('70000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', 12500.00, 'NGN', '{"fixture":true,"test_balance":true}'::jsonb)
on conflict (id) do update set balance = excluded.balance;

insert into public.wallet_transactions (id, wallet_id, user_id, estate_id, home_id, membership_id, direction, type, amount, reference, status, metadata, created_at)
values
  ('71000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', 'debit', 'electricity', 2500.00, 'W11-ELECTRICITY', 'completed', '{"fixture":true}'::jsonb, now() - interval '2 days'),
  ('71000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', 'credit', 'topup', 15000.00, 'W11-TOPUP', 'completed', '{"fixture":true}'::jsonb, now() - interval '6 days')
on conflict (id) do nothing;

commit;
