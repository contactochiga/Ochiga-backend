#!/usr/bin/env node
// Facility Spatial Mode Convergence, Foundation Slice 2 -- Facility
// Spatial Mode readiness resolver. Real behavioral coverage against the
// compiled resolveFacilitySpatialReadiness() with a controllable fake
// Supabase client standing in for twin_models/twin_entity_placements --
// same monkeypatch-supabaseAdmin.from pattern as
// facility-canonical-ref-resolver-smoke.mjs. No live database required.
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "local-smoke-service-role-key";

const { resolveFacilitySpatialReadiness } = await import("../dist/services/facilitySpatialReadiness.js");
const { supabaseAdmin } = await import("../dist/supabase/supabaseClient.js");

const failures = [];
function need(condition, message) {
  if (!condition) failures.push(message);
}

const originalFrom = supabaseAdmin.from.bind(supabaseAdmin);

function makeTable(rows) {
  return {
    select() {
      const filters = {};
      const builder = {
        eq(col, val) {
          filters[col] = val;
          return builder;
        },
        then(resolve) {
          const matched = rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
          resolve({ data: matched, error: null });
        },
      };
      return builder;
    },
  };
}

function fakeFrom({ models = [], placements = [] }) {
  return (table) => {
    if (table === "twin_models") return makeTable(models);
    if (table === "twin_entity_placements") return makeTable(placements);
    return originalFrom(table);
  };
}

// 1. No Twin registered at all for this estate -> standard_only. Standard
// Mode must still be available.
{
  supabaseAdmin.from = fakeFrom({ models: [], placements: [] });
  const readiness = await resolveFacilitySpatialReadiness("estate-1", null);
  need(readiness.mode === "standard_only", `expected standard_only, got ${readiness.mode}`);
  need(readiness.standard_mode_available === true, "Standard Mode must always be available");
  need(readiness.spatial_mode_available === false, "spatial_mode_available must be false with no Twin data");
  need(readiness.twin.operationally_connected === false, "operationally_connected must never be fabricated true");
  supabaseAdmin.from = originalFrom;
}

// 2. Model registered but still processing (not yet "available") ->
// spatial_preparing, not falsely available.
{
  supabaseAdmin.from = fakeFrom({
    models: [{ id: "model-1", estate_id: "estate-1", state: "processing", assigned_scope: "estate", assigned_entity_id: null }],
    placements: [],
  });
  const readiness = await resolveFacilitySpatialReadiness("estate-1", null);
  need(readiness.mode === "spatial_preparing", `expected spatial_preparing, got ${readiness.mode}`);
  need(readiness.spatial_mode_available === false, "a processing-only model must not report Spatial Mode as available");
  need(readiness.standard_mode_available === true, "Standard Mode must remain available while Spatial Mode is preparing");
  supabaseAdmin.from = originalFrom;
}

// 3. Every registered model failed -> spatial_temporarily_unavailable,
// not silently folded into "preparing".
{
  supabaseAdmin.from = fakeFrom({
    models: [{ id: "model-1", estate_id: "estate-1", state: "failed", assigned_scope: "estate", assigned_entity_id: null }],
    placements: [],
  });
  const readiness = await resolveFacilitySpatialReadiness("estate-1", null);
  need(readiness.mode === "spatial_temporarily_unavailable", `expected spatial_temporarily_unavailable, got ${readiness.mode}`);
  need(readiness.standard_mode_available === true, "Standard Mode must remain available even when Spatial Mode has failed");
  supabaseAdmin.from = originalFrom;
}

// 4. Available model but zero bindings -> not falsely called connected
// or available; still spatial_preparing (data is not presentable yet).
{
  supabaseAdmin.from = fakeFrom({
    models: [{ id: "model-1", estate_id: "estate-1", state: "available", assigned_scope: "estate", assigned_entity_id: null }],
    placements: [],
  });
  const readiness = await resolveFacilitySpatialReadiness("estate-1", null);
  need(readiness.mode === "spatial_preparing", `an available model with zero bindings must not be reported as spatial_available, got ${readiness.mode}`);
  need(readiness.twin.model_available === true, "twin.model_available must truthfully reflect the available model");
  need(readiness.twin.bindings_available === false, "twin.bindings_available must be false with zero location_assigned placements");
  need(readiness.twin.operationally_connected === false, "an available-but-unbound model must never be reported as operationally connected");
  supabaseAdmin.from = originalFrom;
}

// 5. Available model + real bindings -> spatial_available, and ONLY
// spatial_available (never spatial_connected -- no connectivity evidence
// exists in this schema).
{
  supabaseAdmin.from = fakeFrom({
    models: [{ id: "model-1", estate_id: "estate-1", state: "available", assigned_scope: "estate", assigned_entity_id: null }],
    placements: [{ id: "p-1", estate_id: "estate-1", location_state: "location_assigned", building_id: null }],
  });
  const readiness = await resolveFacilitySpatialReadiness("estate-1", null);
  need(readiness.mode === "spatial_available", `expected spatial_available, got ${readiness.mode}`);
  need(readiness.spatial_mode_available === true, "spatial_mode_available must be true once model + bindings are both real");
  need(readiness.mode !== "spatial_connected", "spatial_connected must never be produced -- no live connectivity evidence exists today");
  need(readiness.twin.operationally_connected === false, "operationally_connected must stay false even at full spatial_available");
  need(readiness.standard_mode_available === true, "Standard Mode must remain available even at full spatial_available");
  supabaseAdmin.from = originalFrom;
}

// 6. Building-level scoping: an estate-wide model covers every building,
// but a building-scoped model/placement belonging to a DIFFERENT building
// must not count as evidence for the building actually being asked
// about.
{
  supabaseAdmin.from = fakeFrom({
    models: [{ id: "model-b2", estate_id: "estate-1", state: "available", assigned_scope: "building", assigned_entity_id: "building-2" }],
    placements: [{ id: "p-b2", estate_id: "estate-1", location_state: "location_assigned", building_id: "building-2" }],
  });
  const readinessForOtherBuilding = await resolveFacilitySpatialReadiness("estate-1", "building-1");
  need(readinessForOtherBuilding.mode === "standard_only", `a different building's Twin data must not leak into this building's readiness, got ${readinessForOtherBuilding.mode}`);
  need(readinessForOtherBuilding.scope.level === "building", "an explicit buildingId must report scope.level = building");
  need(readinessForOtherBuilding.scope.building_id === "building-1", "scope.building_id must echo back the building actually asked about");

  const readinessForOwnBuilding = await resolveFacilitySpatialReadiness("estate-1", "building-2");
  need(readinessForOwnBuilding.mode === "spatial_available", `the owning building must see its own Twin data as available, got ${readinessForOwnBuilding.mode}`);
  supabaseAdmin.from = originalFrom;
}

// 7. Building-level scoping: an estate-wide model (assigned_scope
// "estate") DOES cover every building, by definition.
{
  supabaseAdmin.from = fakeFrom({
    models: [{ id: "model-estate", estate_id: "estate-1", state: "available", assigned_scope: "estate", assigned_entity_id: null }],
    placements: [{ id: "p-b1", estate_id: "estate-1", location_state: "location_assigned", building_id: "building-1" }],
  });
  const readiness = await resolveFacilitySpatialReadiness("estate-1", "building-1");
  need(readiness.mode === "spatial_available", `an estate-wide model must cover a specific building's readiness too, got ${readiness.mode}`);
  supabaseAdmin.from = originalFrom;
}

// 8. No buildingId given -> estate-level scope is reported honestly as
// "estate", not silently mislabeled as building-level.
{
  supabaseAdmin.from = fakeFrom({ models: [], placements: [] });
  const readiness = await resolveFacilitySpatialReadiness("estate-1", null);
  need(readiness.scope.level === "estate", `omitting buildingId must report scope.level = estate, got ${readiness.scope.level}`);
  need(readiness.scope.building_id === null, "estate-level readiness must not fabricate a building_id");
  supabaseAdmin.from = originalFrom;
}

if (failures.length) {
  console.error(`FAIL facility-spatial-readiness-smoke (${failures.length} failure(s)):`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log("PASS facility-spatial-readiness-smoke");
