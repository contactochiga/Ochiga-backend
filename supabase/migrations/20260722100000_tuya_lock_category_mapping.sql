-- Normalize Tuya smart-lock categories that Tuya reports outside the generic
-- "ms" category family. Keep devices unassigned unless Facility has explicitly
-- assigned them to a home.

update public.devices
set
  type = 'lock',
  category = 'lock',
  sync_state = case when home_id is null then 'available_unassigned' else 'assigned' end,
  metadata = coalesce(metadata, '{}'::jsonb)
    || jsonb_build_object(
      'device_family', 'lock',
      'control_profile', 'lock',
      'supported_controls', jsonb_build_array('lock'),
      'capability_codes', jsonb_build_array(
        'lock_state',
        'remote_lock',
        'remote_unlock',
        'door_state',
        'battery_level'
      )
    ),
  updated_at = now()
where lower(coalesce(provider, vendor, adapter, '')) = 'tuya'
  and lower(coalesce(metadata->'raw'->>'category', metadata->>'category', category, type, '')) in (
    'jtmspro',
    'jtmsbh',
    'jtms',
    'door_lock',
    'smart_lock',
    'doorlock'
  );
