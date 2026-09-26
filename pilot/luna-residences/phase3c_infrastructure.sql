-- Luna Residences Phase 3C — Building Infrastructure & Operational Systems
-- Local-only proof data. Not part of any tracked migration; applied directly
-- against the local Docker Postgres instance for digital-twin validation.

-- Looked up dynamically (not hardcoded) so this script is genuinely
-- re-runnable against any freshly reconstructed instance without manual
-- UUID editing -- confirmed necessary during the Phase 3D reproducibility
-- checkpoint, where the original hardcoded IDs did not match a fresh
-- instance's newly generated rows.
select id as estate_id from estates where name = 'Luna Residences' \gset
select id as building_id from estate_buildings where building_ref = 'luna-tower' \gset

-- ============================================================
-- 1. Edge node (Oyi Core placeholder)
-- ============================================================
insert into edge_nodes (edge_node_id, estate_id, name, metadata)
values ('LUNA-EDGE-CORE-01', :'estate_id', 'Luna Oyi Edge Core',
        '{"simulated": true, "notes": "Local digital-twin prototype placeholder, no real edge runtime connected"}'::jsonb);

-- ============================================================
-- 2. Devices — building-wide infrastructure (home_id/room_id = NULL)
-- ============================================================
insert into devices (estate_id, name, type, category, adapter, external_id, canonical_ref,
                      capabilities, online, status, bind_state, edge_node_id, sync_state, metadata)
values
-- Electrical
(:'estate_id', 'Grid / Incoming Supply', 'power_system', 'Grid / Incoming Supply', 'placeholder', 'LUNA-B1-ELECTRICAL-GRID-01', 'LUNA-B1-ELECTRICAL-GRID-01', '[]', false, 'pending', 'estate_bound', 'LUNA-EDGE-CORE-01', 'pending_integration', '{"simulated": true, "notes": "Asset-only, no live telemetry point at this simple incoming-supply level"}'::jsonb),
(:'estate_id', 'Main Electrical Distribution Board', 'power_system', 'Main Electrical Distribution Board', 'placeholder', 'LUNA-B1-ELECTRICAL-MDB-01', 'LUNA-B1-ELECTRICAL-MDB-01', '[]', false, 'pending', 'estate_bound', 'LUNA-EDGE-CORE-01', 'pending_integration', '{"simulated": true, "notes": "Asset-only, no live telemetry point"}'::jsonb),
(:'estate_id', 'Standby Generator 01', 'power_system', 'Standby Generator', 'placeholder', 'LUNA-B1-ELECTRICAL-GEN-01', 'LUNA-B1-ELECTRICAL-GEN-01', '["power.on", "power.off", "set_mode"]', false, 'pending', 'estate_bound', 'LUNA-EDGE-CORE-01', 'pending_integration', '{"simulated": true}'::jsonb),
(:'estate_id', 'ATS / Changeover Switch 01', 'controller', 'ATS / Changeover Switch', 'placeholder', 'LUNA-B1-ELECTRICAL-ATS-01', 'LUNA-B1-ELECTRICAL-ATS-01', '["set_source"]', false, 'pending', 'estate_bound', 'LUNA-EDGE-CORE-01', 'pending_integration', '{"simulated": true}'::jsonb),
(:'estate_id', 'Inverter / Battery Backup (Representative)', 'power_system', 'Inverter / Battery Backup', 'placeholder', 'LUNA-B1-ELECTRICAL-INV-01', 'LUNA-B1-ELECTRICAL-INV-01', '["power.on", "power.off"]', false, 'pending', 'estate_bound', 'LUNA-EDGE-CORE-01', 'pending_integration', '{"simulated": true}'::jsonb),
(:'estate_id', 'Main Electricity Meter (Building)', 'energy_meter', 'Electricity Meter', 'placeholder', 'LUNA-B1-ELECTRICAL-METER-01', 'LUNA-B1-ELECTRICAL-METER-01', '[]', false, 'pending', 'estate_bound', 'LUNA-EDGE-CORE-01', 'pending_integration', '{"simulated": true}'::jsonb),
-- Water
(:'estate_id', 'Main Water Storage Tank', 'infrastructure_asset', 'Main Water Storage Tank', 'placeholder', 'LUNA-B1-WATER-TANK-01', 'LUNA-B1-WATER-TANK-01', '[]', false, 'pending', 'estate_bound', 'LUNA-EDGE-CORE-01', 'pending_integration', '{"simulated": true}'::jsonb),
(:'estate_id', 'Water Treatment Unit', 'infrastructure_asset', 'Water Treatment Unit', 'placeholder', 'LUNA-B1-WATER-TREAT-01', 'LUNA-B1-WATER-TREAT-01', '[]', false, 'pending', 'estate_bound', 'LUNA-EDGE-CORE-01', 'pending_integration', '{"simulated": true}'::jsonb),
(:'estate_id', 'Booster Pump 01', 'pump', 'Booster Pump', 'placeholder', 'LUNA-B1-WATER-BP-01', 'LUNA-B1-WATER-BP-01', '["power.on", "power.off"]', false, 'pending', 'estate_bound', 'LUNA-EDGE-CORE-01', 'pending_integration', '{"simulated": true}'::jsonb),
(:'estate_id', 'Booster Pump 02', 'pump', 'Booster Pump', 'placeholder', 'LUNA-B1-WATER-BP-02', 'LUNA-B1-WATER-BP-02', '["power.on", "power.off"]', false, 'pending', 'estate_bound', 'LUNA-EDGE-CORE-01', 'pending_integration', '{"simulated": true, "notes": "Standby pump, duty/standby pair with BP-01"}'::jsonb),
(:'estate_id', 'Main Water Meter (Building)', 'water_meter', 'Water Meter', 'placeholder', 'LUNA-B1-WATER-METER-01', 'LUNA-B1-WATER-METER-01', '[]', false, 'pending', 'estate_bound', 'LUNA-EDGE-CORE-01', 'pending_integration', '{"simulated": true, "notes": "Measures incoming municipal supply, independent of tank"}'::jsonb),
(:'estate_id', 'Water Isolation/Control Valve (Building Main)', 'switch', 'Water Isolation Valve', 'placeholder', 'LUNA-B1-WATER-VALVE-01', 'LUNA-B1-WATER-VALVE-01', '["open", "close"]', false, 'pending', 'estate_bound', 'LUNA-EDGE-CORE-01', 'pending_integration', '{"simulated": true}'::jsonb),
-- Fire
(:'estate_id', 'Fire Alarm Control Panel', 'controller', 'Fire Alarm Control Panel', 'placeholder', 'LUNA-B1-FIRE-PANEL-01', 'LUNA-B1-FIRE-PANEL-01', '["silence", "reset"]', false, 'pending', 'estate_bound', 'LUNA-EDGE-CORE-01', 'pending_integration', '{"simulated": true}'::jsonb),
(:'estate_id', 'Fire Pump', 'pump', 'Fire Pump', 'placeholder', 'LUNA-B1-FIRE-PUMP-01', 'LUNA-B1-FIRE-PUMP-01', '["power.on", "power.off"]', false, 'pending', 'estate_bound', 'LUNA-EDGE-CORE-01', 'pending_integration', '{"simulated": true}'::jsonb),
(:'estate_id', 'Fire Water Tank', 'infrastructure_asset', 'Fire Water Tank', 'placeholder', 'LUNA-B1-FIRE-TANK-01', 'LUNA-B1-FIRE-TANK-01', '[]', false, 'pending', 'estate_bound', 'LUNA-EDGE-CORE-01', 'pending_integration', '{"simulated": true}'::jsonb),
(:'estate_id', 'Fire Detector (Common Area, Ground)', 'sensor', 'Fire Detector', 'placeholder', 'LUNA-GROUND-FIRE-DET-01', 'LUNA-GROUND-FIRE-DET-01', '[]', false, 'pending', 'estate_bound', 'LUNA-EDGE-CORE-01', 'pending_integration', '{"simulated": true}'::jsonb),
-- Common-area HVAC
(:'estate_id', 'Common-Area AHU / Chiller Plant (Rooftop)', 'climate', 'Common-Area HVAC Plant', 'placeholder', 'LUNA-ROOFTOP-HVAC-PLANT-01', 'LUNA-ROOFTOP-HVAC-PLANT-01', '["power.on", "power.off", "set_mode"]', false, 'pending', 'estate_bound', 'LUNA-EDGE-CORE-01', 'pending_integration', '{"simulated": true}'::jsonb),
-- Vertical transportation
(:'estate_id', 'Passenger Elevator 01', 'elevator', 'Passenger Elevator', 'placeholder', 'LUNA-LIFT-PASS-01', 'LUNA-LIFT-PASS-01', '["call", "select_floor"]', false, 'pending', 'estate_bound', 'LUNA-EDGE-CORE-01', 'pending_integration', '{"simulated": true}'::jsonb),
(:'estate_id', 'Passenger Elevator 02', 'elevator', 'Passenger Elevator', 'placeholder', 'LUNA-LIFT-PASS-02', 'LUNA-LIFT-PASS-02', '["call", "select_floor"]', false, 'pending', 'estate_bound', 'LUNA-EDGE-CORE-01', 'pending_integration', '{"simulated": true}'::jsonb),
(:'estate_id', 'Passenger Elevator 03', 'elevator', 'Passenger Elevator', 'placeholder', 'LUNA-LIFT-PASS-03', 'LUNA-LIFT-PASS-03', '["call", "select_floor"]', false, 'pending', 'estate_bound', 'LUNA-EDGE-CORE-01', 'pending_integration', '{"simulated": true}'::jsonb),
(:'estate_id', 'Service / Fire Elevator 01', 'elevator', 'Service / Fire Elevator', 'placeholder', 'LUNA-LIFT-SERVICE-01', 'LUNA-LIFT-SERVICE-01', '["call", "select_floor", "fire_service_mode"]', false, 'pending', 'estate_bound', 'LUNA-EDGE-CORE-01', 'pending_integration', '{"simulated": true}'::jsonb),
-- Network / Edge
(:'estate_id', 'Core Network Gateway / Router', 'gateway', 'Core Network Gateway', 'placeholder', 'LUNA-B1-NET-GATEWAY-01', 'LUNA-B1-NET-GATEWAY-01', '[]', false, 'pending', 'estate_bound', 'LUNA-EDGE-CORE-01', 'pending_integration', '{"simulated": true}'::jsonb),
(:'estate_id', 'Wi-Fi Access Point (Common Area)', 'gateway', 'Wi-Fi Access Point', 'placeholder', 'LUNA-GROUND-NET-WIFI-AP-01', 'LUNA-GROUND-NET-WIFI-AP-01', '[]', false, 'pending', 'estate_bound', 'LUNA-EDGE-CORE-01', 'pending_integration', '{"simulated": true}'::jsonb);

-- ============================================================
-- 3. Parent/child asset relationships
-- ============================================================
update devices c set parent_device_id = p.id
from devices p
where c.estate_id = :'estate_id' and p.estate_id = :'estate_id'
  and (p.canonical_ref, c.canonical_ref) in (
    ('LUNA-B1-ELECTRICAL-GRID-01', 'LUNA-B1-ELECTRICAL-MDB-01'),
    ('LUNA-B1-ELECTRICAL-MDB-01',  'LUNA-B1-ELECTRICAL-ATS-01'),
    ('LUNA-B1-ELECTRICAL-MDB-01',  'LUNA-B1-ELECTRICAL-INV-01'),
    ('LUNA-B1-ELECTRICAL-MDB-01',  'LUNA-B1-ELECTRICAL-METER-01'),
    ('LUNA-B1-WATER-TANK-01',      'LUNA-B1-WATER-TREAT-01'),
    ('LUNA-B1-WATER-TANK-01',      'LUNA-B1-WATER-BP-01'),
    ('LUNA-B1-WATER-TANK-01',      'LUNA-B1-WATER-BP-02'),
    ('LUNA-B1-FIRE-PANEL-01',      'LUNA-B1-FIRE-PUMP-01'),
    ('LUNA-B1-FIRE-PANEL-01',      'LUNA-GROUND-FIRE-DET-01'),
    ('LUNA-B1-NET-GATEWAY-01',     'LUNA-GROUND-NET-WIFI-AP-01')
  );

-- ============================================================
-- 4. Simulated device_states for state-bearing objects
--    (asset-only items above intentionally get NO row here)
-- ============================================================
insert into device_states (device_id, status)
select id, status_json from devices, (values
  ('LUNA-B1-ELECTRICAL-GEN-01',      '{"simulated": true, "running": false, "fuel_level_pct": 82, "mode": "auto"}'::jsonb),
  ('LUNA-B1-ELECTRICAL-ATS-01',      '{"simulated": true, "source": "grid", "auto_mode": true, "fault": false}'::jsonb),
  ('LUNA-B1-ELECTRICAL-INV-01',      '{"simulated": true, "on": true, "battery_pct": 76, "load_pct": 32}'::jsonb),
  ('LUNA-B1-ELECTRICAL-METER-01',    '{"simulated": true, "reading_kwh": 0}'::jsonb),
  ('LUNA-B1-WATER-TANK-01',          '{"simulated": true, "level_pct": 68}'::jsonb),
  ('LUNA-B1-WATER-TREAT-01',         '{"simulated": true, "running": true, "fault": false}'::jsonb),
  ('LUNA-B1-WATER-BP-01',            '{"simulated": true, "running": true, "pressure_bar": 3.2, "fault": false}'::jsonb),
  ('LUNA-B1-WATER-BP-02',            '{"simulated": true, "running": false, "pressure_bar": 0, "fault": false}'::jsonb),
  ('LUNA-B1-WATER-METER-01',         '{"simulated": true, "reading_m3": 0}'::jsonb),
  ('LUNA-B1-WATER-VALVE-01',         '{"simulated": true, "open": true}'::jsonb),
  ('LUNA-B1-FIRE-PANEL-01',          '{"simulated": true, "alarm_active": false, "trouble": false, "zones_ok": true}'::jsonb),
  ('LUNA-B1-FIRE-PUMP-01',           '{"simulated": true, "running": false, "pressure_bar": 0, "fault": false}'::jsonb),
  ('LUNA-GROUND-FIRE-DET-01',        '{"simulated": true, "alarm": false}'::jsonb),
  ('LUNA-ROOFTOP-HVAC-PLANT-01',     '{"simulated": true, "power": "on", "mode": "cool", "supply_temp_c": 18}'::jsonb),
  ('LUNA-LIFT-PASS-01',              '{"simulated": true, "floor": "GROUND", "direction": "idle", "door": "closed", "fault": false}'::jsonb),
  ('LUNA-LIFT-PASS-02',              '{"simulated": true, "floor": "GROUND", "direction": "idle", "door": "closed", "fault": false}'::jsonb),
  ('LUNA-LIFT-PASS-03',              '{"simulated": true, "floor": "GROUND", "direction": "idle", "door": "closed", "fault": false}'::jsonb),
  ('LUNA-LIFT-SERVICE-01',           '{"simulated": true, "floor": "GROUND", "direction": "idle", "door": "closed", "fault": false, "fire_service_mode": false}'::jsonb),
  ('LUNA-B1-NET-GATEWAY-01',         '{"simulated": true, "uplink_up": true}'::jsonb),
  ('LUNA-GROUND-NET-WIFI-AP-01',     '{"simulated": true, "clients_connected": 0}'::jsonb)
) as seed(ref, status_json)
where devices.canonical_ref = seed.ref;

-- ============================================================
-- 5. Cameras (facility_cameras — existing camera platform)
-- ============================================================
insert into facility_cameras (estate_id, zone_id, camera_id, name, location, dvr_nvr_ref, stream_protocol, status, health_status, metadata)
select :'estate_id', z.id, c.camera_id, c.name, c.location, 'LUNA-B1-NVR-01', 'rtsp', 'pending', 'pending_stream_details',
       '{"simulated": true}'::jsonb
from estate_zones z, (values
  ('LUNA-GROUND-SEC-CAM-01', 'Ground Entrance Camera', 'Main Entrance', 'LUNA-GROUND-1'),
  ('LUNA-GROUND-LOBBY-CAM-01', 'Lobby Camera', 'Lobby', 'LUNA-GROUND-1'),
  ('LUNA-B1-PARKING-CAM-01', 'Parking / B1 Camera', 'Basement Parking', 'LUNA-BASEMENT-1'),
  ('LUNA-L06-COMMON-CAM-01', 'Floor 6 Common Area Camera', 'Level 6 Corridor', 'LUNA-FLOOR-06')
) as c(camera_id, name, location, zone_ref)
where z.estate_id = :'estate_id' and z.zone_ref = c.zone_ref;

-- ============================================================
-- 6. Access points (existing access-control platform)
-- ============================================================
insert into access_points (estate_id, zone_id, access_point_ref, name, access_type, status, metadata)
select :'estate_id', z.id, a.ref, a.name, a.access_type, 'pending', '{"simulated": true}'::jsonb
from estate_zones z, (values
  ('LUNA-GROUND-ACCESS-MAIN-01', 'Main Resident Entrance', 'pedestrian_entrance', 'LUNA-GROUND-1'),
  ('LUNA-B1-ACCESS-SERVICE-01', 'Service Entrance', 'service_entrance', 'LUNA-BASEMENT-1'),
  ('LUNA-GROUND-ACCESS-LIFT-LOBBY-01', 'Lift Lobby Access (Ground)', 'lift_lobby', 'LUNA-GROUND-1')
) as a(ref, name, access_type, zone_ref)
where z.estate_id = :'estate_id' and z.zone_ref = a.zone_ref;

-- ============================================================
-- 7. Spatial placements (twin_entity_placements) for building-wide
--    devices, cameras, and the edge node
-- ============================================================
insert into twin_entity_placements (estate_id, entity_type, entity_id, location_state, label, building_id, zone, floor, metadata)
select :'estate_id', 'device', d.id, 'location_assigned', d.name, :'building_id', p.zone_ref, p.floor_label, '{"simulated": true}'::jsonb
from devices d, (values
  ('LUNA-B1-ELECTRICAL-GRID-01', 'LUNA-BASEMENT-1', 'B1'),
  ('LUNA-B1-ELECTRICAL-MDB-01', 'LUNA-BASEMENT-1', 'B1'),
  ('LUNA-B1-ELECTRICAL-GEN-01', 'LUNA-BASEMENT-1', 'B1'),
  ('LUNA-B1-ELECTRICAL-ATS-01', 'LUNA-BASEMENT-1', 'B1'),
  ('LUNA-B1-ELECTRICAL-INV-01', 'LUNA-BASEMENT-1', 'B1'),
  ('LUNA-B1-ELECTRICAL-METER-01', 'LUNA-BASEMENT-1', 'B1'),
  ('LUNA-B1-WATER-TANK-01', 'LUNA-BASEMENT-1', 'B1'),
  ('LUNA-B1-WATER-TREAT-01', 'LUNA-BASEMENT-1', 'B1'),
  ('LUNA-B1-WATER-BP-01', 'LUNA-BASEMENT-1', 'B1'),
  ('LUNA-B1-WATER-BP-02', 'LUNA-BASEMENT-1', 'B1'),
  ('LUNA-B1-WATER-METER-01', 'LUNA-BASEMENT-1', 'B1'),
  ('LUNA-B1-WATER-VALVE-01', 'LUNA-BASEMENT-1', 'B1'),
  ('LUNA-B1-FIRE-PANEL-01', 'LUNA-BASEMENT-1', 'B1'),
  ('LUNA-B1-FIRE-PUMP-01', 'LUNA-BASEMENT-1', 'B1'),
  ('LUNA-B1-FIRE-TANK-01', 'LUNA-BASEMENT-1', 'B1'),
  ('LUNA-GROUND-FIRE-DET-01', 'LUNA-GROUND-1', 'Ground'),
  ('LUNA-ROOFTOP-HVAC-PLANT-01', 'LUNA-ROOFTOP', 'Rooftop'),
  ('LUNA-B1-NET-GATEWAY-01', 'LUNA-BASEMENT-1', 'B1'),
  ('LUNA-GROUND-NET-WIFI-AP-01', 'LUNA-GROUND-1', 'Ground')
) as p(ref, zone_ref, floor_label)
where d.canonical_ref = p.ref and d.estate_id = :'estate_id';

-- Elevators: building-wide, not fixed to one floor/zone (dynamic state, not static placement)
insert into twin_entity_placements (estate_id, entity_type, entity_id, location_state, label, building_id, metadata)
select :'estate_id', 'device', d.id, 'location_assigned', d.name, :'building_id',
       '{"simulated": true, "notes": "Traverses all floors; current floor is dynamic state in device_states, not a static placement"}'::jsonb
from devices d
where d.estate_id = :'estate_id' and d.canonical_ref in ('LUNA-LIFT-PASS-01','LUNA-LIFT-PASS-02','LUNA-LIFT-PASS-03','LUNA-LIFT-SERVICE-01');

-- Cameras
insert into twin_entity_placements (estate_id, entity_type, entity_id, location_state, label, building_id, zone, metadata)
select :'estate_id', 'camera', fc.id, 'location_assigned', fc.name, :'building_id', z.zone_ref, '{"simulated": true}'::jsonb
from facility_cameras fc join estate_zones z on z.id = fc.zone_id
where fc.estate_id = :'estate_id';

-- Edge node
insert into twin_entity_placements (estate_id, entity_type, entity_id, location_state, label, building_id, zone, metadata)
select :'estate_id', 'edge_node', en.id, 'location_assigned', en.name, :'building_id', 'LUNA-BASEMENT-1', '{"simulated": true}'::jsonb
from edge_nodes en
where en.estate_id = :'estate_id' and en.edge_node_id = 'LUNA-EDGE-CORE-01';
