# Oyi Digital Twin Asset Contract

Status: **V1 frozen** (Phases 1–3C, reproducibility-verified). Database
scope for Luna's operational/data foundation is closed — no further backend
assets are to be added for completeness; the representative dataset already
proves the contract. Still local-only, not yet applied to production. This
document describes a **reusable standard** for onboarding any future Oyi
building into the digital-twin data model — Luna is the first proof, not
the scope.

Reproducibility confirmed (Phase 3D checkpoint): the full Luna dataset —
estate, building, 16 zones, 43 homes, 12 rooms, 42 devices, 20 device
states, 4 cameras, 3 access points, 1 edge node — was independently
reconstructed byte-for-byte from an empty local Supabase instance using
only `migrations/schema.sql`, the tracked `supabase/migrations/*.sql`
files, and `pilot/luna-residences/` (`pilot-import.mjs` +
`phase3c_infrastructure.sql`), in a fully isolated environment that never
touched the live database. All three canonical-reference uniqueness rules
(`homes`, `rooms`, `devices`) were re-verified to reject duplicates on the
freshly rebuilt instance. One process note from that checkpoint:
`phase3c_infrastructure.sql` originally hardcoded this estate's specific
UUIDs; it now looks up `estate_id`/`building_id` dynamically via `\gset`
so it is genuinely re-runnable rather than a one-shot script.

A pre-existing, Luna-unrelated repo issue was independently reconfirmed
during this checkpoint: replaying the *full* `supabase/migrations/`
history from empty fails (`camera_events.sql` references
`facility_cameras` before its own creation; a separate migration
references a `community_posts` table that has no `CREATE TABLE` anywhere
in the repository). Luna's local environment is built from the same
proven minimal migration subset established in Phase 1
(`migrations/schema.sql` bootstrap + `tier1_foundation_audit_events` +
`pilot_onboarding_foundation` + `create_device_states` +
`platform_gap_closure_stage_b` + `infrastructure_onboarding_engine` + the
five `LOCAL_TEST_*` migrations), not the full history. This is a
repo-wide gap, not something introduced by or blocking Luna.

## 1. Purpose

Every physical or logical object that a future GLB/Three.js visual twin needs
to address — a building, a floor, an apartment, a room, a light circuit, a
generator, a camera, an edge box — must be reachable two ways:

1. **By stable identity** — a name that never changes even if a human-facing
   label does, so a 3D scene-graph node can be matched to a database row by
   string equality, forever.
2. **By spatial containment** — a deterministic path from the estate down to
   that object, so the twin can be rendered hierarchically.

This contract defines how both are represented today, using only the
schema's own existing conventions.

## 2. Identity: one column per table, not one shared table

The audit trail across Phases 2–3C repeatedly asked "should there be a single
central identity table?" The answer, confirmed each time, is **no** — every
table that needs a stable identity already gets one nullable, uniquely
indexed column, and that pattern is now uniform:

| Table | Identity column | Constraint |
|---|---|---|
| `homes` | `canonical_ref` | partial unique index (`where canonical_ref is not null`) |
| `rooms` | `canonical_ref` | partial unique index |
| `devices` | `canonical_ref` | partial unique index |
| `facility_cameras` | `camera_id` (pre-existing) | unique per `(estate_id, camera_id)` |
| `access_points` | `access_point_ref` (pre-existing) | unique per `(estate_id, access_point_ref)` |
| `edge_nodes` | `edge_node_id` (pre-existing) | unique per `(estate_id, edge_node_id)` |

Rules that apply to every identity column:
- **Nullable, no default.** Every pre-existing row (local or production)
  keeps working unchanged with the value unset.
- **Partial unique index**, not a bare `UNIQUE` constraint, wherever the
  column was newly added — a bare unique constraint on a nullable column
  only tolerates a single `NULL` row across the *entire* table, which would
  break every other estate's data the moment a second row omitted it.
- **Persisted explicitly, never derived at runtime** from `name`/`unit`/
  `floor`/etc. Display labels may be renamed by an operator; the identity
  must not change when they are.
- **Do not add a new identity column to a table that already has one.**
  `facility_cameras`, `access_points`, and `edge_nodes` already had a fit
  purpose-built column before this contract existed — reuse it.

### Naming convention

```
{ESTATE}-{CONTAINER}-{OBJECT}-{SEQ}
```

Examples actually used in Luna:
- `LUNA-L06-APT-A` — home (floor + unit)
- `LUNA-L06-APT-A-LIVING` — room (home + room)
- `LUNA-L06-APT-A-LIVING-AC-01` — apartment device (home + room + type + seq)
- `LUNA-B1-ELECTRICAL-GEN-01` — building asset (zone/system + type + seq)
- `LUNA-LIFT-PASS-01` — building-wide asset with no fixed floor
- `LUNA-EDGE-CORE-01` — edge node

Human-readable labels (`name`, `unit`, `category`) are always a *separate*
column from the identity column. They may change; the identity does not.

## 3. Spatial containment

Two different mechanisms cover two different situations — use whichever
already fits, do not add a third.

**A. Direct foreign keys**, for objects that belong to exactly one obvious
parent for their whole lifetime:
- `homes.zone_id → estate_zones.id`, `homes.building_id → estate_buildings.id`
- `rooms.home_id → homes.id`
- `devices.home_id → homes.id`, `devices.room_id → rooms.id`
- `facility_cameras.zone_id → estate_zones.id`
- `access_points.zone_id → estate_zones.id`

All of the above use `on delete set null` — deleting a zone, building, home,
or room must never delete the object that sits inside it, only clear the
reference. This has been empirically verified at every phase, not just
read from the DDL.

**B. `twin_entity_placements`**, for objects with no single obvious
container column — mainly building-wide infrastructure that isn't bound to
one home or room (a generator, a booster pump, a fire panel, a passenger
elevator that visits every floor). This table already existed
(`20260602230840_platform_gap_closure_stage_b.sql`) and is the platform's
own generic spatial-binding layer:

```
entity_type: building | home | room | device | camera | edge_node |
             maintenance | incident | utility | zone
entity_id:   uuid of the row in whichever table entity_type names
building_id, zone (text), floor (text), coordinates (jsonb)
```

Do not add `zone_id`/`building_id` columns directly to `devices` —
`twin_entity_placements` already solves exactly this, for exactly the
objects that need it, without a schema change.

Known looseness in this existing table (not fixed here, just disclosed):
`building_id` has no declared foreign key, and `zone` is free text rather
than a real reference to `estate_zones.id`. It is still populated correctly
by convention (the real building UUID, the real zone_ref string) but
nothing at the database level enforces it.

## 4. Classifying an object: physical asset vs. device vs. sensor vs.
   controller vs. meter vs. camera vs. edge node vs. state/telemetry

This distinction is not a new concept — an existing migration
(`20260716234055_infrastructure_onboarding_engine.sql`) already states the
platform's intent directly: *"Operational objects are promoted into the
existing device, camera, Edge, service, and Twin registries."* This
contract simply codifies that:

| Concept | Where it lives | Notes |
|---|---|---|
| Camera | `facility_cameras` | Never modeled as a `devices` row. |
| Edge node / Oyi Core | `edge_nodes` | Never modeled as a `devices` row. |
| Access control point | `access_points` | Never modeled as a `devices` row. |
| Everything else (physical asset, operational device, sensor, controller, meter, pump, elevator) | `devices` | See below for how the sub-distinction is expressed. |
| Live state | `device_states` (1 row per device, current snapshot) | Absence of a row = no live telemetry for that object. |
| Historical telemetry | `utility_telemetry`, `edge_heartbeats`, `camera_health_history` (all pre-existing) | Out of scope for this phase's structural proof; time-series, not current-state. |

Within `devices`, the finer distinction is expressed with columns that
already exist — no new columns were needed for this:

- **`capabilities` (jsonb array)** — the presence of one or more actions
  (`["lock","unlock"]`, `["power.on","power.off"]`) means **controllable**.
  An empty array means **observable only** (sensors, meters) or, combined
  with no `device_states` row, **asset-only** (a water tank or distribution
  board with no instrumentation in this prototype).
- **`type`** — coarse family (`lock`, `light`, `curtain`, `climate`,
  `sensor`, `switch`, `energy_meter`, `water_meter`, `gateway`, `controller`,
  `power_system`). Two pragmatic additions were needed and are disclosed
  here rather than forced into a bad-fitting existing value: **`pump`** and
  **`elevator`**. Neither has a dedicated family in the runtime
  normalization vocabulary (`src/device/runtime/deviceStateEnrichment.ts`)
  today; `type` has no database CHECK constraint, so this is a safe,
  reversible, disclosed extension rather than a schema change.
- **`category`** — free-text, human-readable specificity layered on top of
  `type` (e.g. `type="pump"`, `category="Fire Pump"`).
- **`parent_device_id`** *(new, this phase)* — nullable self-referential FK,
  `on delete set null`, for asset-to-asset relationships that nothing else
  expressed (a detector reporting to a fire panel, a booster pump belonging
  to a water system, a meter measuring a distribution board's output).

## 5. Simulation, not fabrication

A Luna-style prototype must never *look* like connected hardware when it is
not:
- `adapter = "placeholder"` (an existing, pre-established convention from
  the pilot-import tooling, not invented for this).
- `external_id` mirrors the canonical ref for placeholder devices — never a
  fabricated vendor ID.
- `status = "pending"`, `sync_state = "pending_integration"`,
  `online = false` — all pre-existing default vocabulary that already means
  "exists in the system, not wired to live hardware."
- No fake IP addresses, RTSP URLs, or hostnames are ever written. Cameras
  keep `ip`/`rtsp_url` null and `health_status = "pending_stream_details"`
  (the same default the platform already uses for a camera awaiting real
  stream details). `edge_nodes.local_runtime_host` stays null.
- Every simulated `device_states.status` jsonb blob carries an explicit
  `"simulated": true` key, so a simulated reading can never be mistaken for
  a real one purely by looking at the state payload.
- `camera_dvrs` (the dedicated DVR/NVR table) requires a real, unique,
  `not null` `ip_address` — which cannot be populated honestly for a
  simulated NVR. Luna instead uses `facility_cameras.dvr_nvr_ref` (a
  pre-existing, nullable, free-text grouping key designed for exactly this
  "not yet a real registered DVR" situation) to express which cameras share
  an NVR, without a fabricated IP.

## 6. Facility vs. Consumer authorization

Building-wide infrastructure (generator, pumps, fire systems, cameras,
elevators, network gear) is Facility OS scope by default, and the
platform already enforces this — not through a new mechanism, but through
one that already exists:

- `src/services/deviceProjectionService.ts`: `canConsumerViewDevice` requires
  `device.home_id` to equal the resident's own home id. Every Phase 3C
  building-wide asset has `home_id = NULL`, so it is **automatically
  invisible and uncontrollable from the Consumer surface** — no extra flag
  was needed to achieve this; it falls out of the existing ownership model
  (`deviceOwnershipClass` defaults an unowned, home-less device to
  `"building_managed"`, and consumer visibility never includes that class
  unless a resident's own `home_id` matches, which it structurally cannot
  for shared building plant).
- `canFacilityViewDevice`/`canFacilityControlDevice` gate the Facility
  surface by role (`isFacilityActor`, a regex over
  admin/estate_admin/manager/owner/operator/security/maintenance/facility)
  plus estate match.
- **`device_access_grants`** (schema already exists:
  `20260725113000_enterprise_provider_connections_device_projection.sql`)
  is the correct future mechanism for "selected derived access" — e.g.
  granting one resident `can_view=true, can_control=false` on the lobby
  camera, or lift authorization, via `grant_type in ('resident_home',
  'shared_access', ...)`, without changing the underlying device's
  `building_managed` classification. **Disclosed gap:** this table is not
  yet consulted anywhere in `src/` — it exists as the right shape for this
  problem but is not wired into `projectDeviceForSurface` yet. No rows were
  created in it during Phase 3C; no resident-facing exposure was requested.

## 7. Remaining gaps before GLB/Three.js integration

- `type = "pump"` / `type = "elevator"` are not yet part of the runtime
  device-state-enrichment vocabulary — cosmetic today, worth formalizing if
  Tuya-style real-time enrichment is ever pointed at real pumps/elevators.
- `twin_entity_placements.entity_type` has no `access_point` value, and
  `access_points` were not given placement rows in Phase 3C — not a blocker,
  since `access_points.zone_id` already anchors them directly, but worth
  noting for a future contract revision if a scene graph wants everything
  routed through one placement table for consistency.
- `camera_infrastructure` (relates a camera to a broader system, with a
  free-text `infrastructure_relationship`) exists and was audited but not
  populated in Phase 3C — it's optional enrichment on top of the
  proven camera/placement/parent-device relationships, not required for the
  structural proof.
- No visual/GLB work has started. This document defines the data contract
  a future scene loader would read from — matching a GLB object's name to
  `canonical_ref` (or `camera_id`/`access_point_ref`/`edge_node_id` for
  those three tables) and its parent container via the FK/placement rules
  in §3.
