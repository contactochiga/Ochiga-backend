-- Stabilize Tuya IR inventory after canonical child-appliance promotion.
-- Provider virtual remotes remain in the registry for diagnostics, but they are
-- not resident-facing controllable devices. Canonical children are identified by
-- parent hub + provider remote_id.

update public.devices
set
  is_managed_disabled = true,
  sync_state = 'provider_virtual_remote',
  metadata = coalesce(metadata, '{}'::jsonb)
    || jsonb_build_object(
      'visibility', 'technical',
      'resident_visible', false,
      'provider_virtual_remote', true,
      'hidden_reason', 'tuya_ir_bound_remote_promoted_as_canonical_child'
    ),
  updated_at = now()
where coalesce(is_virtual, false) = false
  and lower(coalesce(provider, vendor, adapter, '')) = 'tuya'
  and lower(coalesce(metadata->'raw'->>'category', metadata->>'category', category, type, '')) in (
    'infrared_tv',
    'infrared_ac',
    'infrared_fan',
    'infrared_stb',
    'infrared_projector'
  );

update public.devices
set
  is_managed_disabled = true,
  status = 'unavailable',
  sync_state = 'obsolete_ir_profile',
  metadata = coalesce(metadata, '{}'::jsonb)
    || jsonb_build_object(
      'visibility', 'technical',
      'resident_visible', false,
      'hidden_reason', 'tuya_ir_child_missing_provider_remote_id'
    ),
  updated_at = now()
where coalesce(is_virtual, false) = true
  and lower(coalesce(provider, vendor, adapter, '')) = 'tuya'
  and external_id like '%:ir:%'
  and nullif(coalesce(metadata->'ir_appliance'->>'remote_id', metadata->'ir_appliance'->>'profile_id', ''), '') is null;

update public.devices child
set
  is_managed_disabled = false,
  status = case when parent.online is false then 'offline' else 'online' end,
  online = parent.online is not false,
  sync_state = case when child.home_id is not null then 'assigned' else 'available_unassigned' end,
  metadata = coalesce(child.metadata, '{}'::jsonb)
    || jsonb_build_object('resident_visible', true)
    - 'hidden_reason',
  updated_at = now()
from public.devices parent
where child.parent_device_id = parent.id
  and coalesce(child.is_virtual, false) = true
  and lower(coalesce(child.provider, child.vendor, child.adapter, '')) = 'tuya'
  and nullif(coalesce(child.metadata->'ir_appliance'->>'remote_id', ''), '') is not null;
