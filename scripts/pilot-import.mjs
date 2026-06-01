#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const args = new Set(process.argv.slice(2));
const getArg = (name, fallback = "") => {
  const prefix = `${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};

const root = process.cwd();
const dataDir = path.resolve(root, getArg("--dir", "pilot/120-unit-template/sample"));
const apply = args.has("--apply");
const allowExisting = args.has("--allow-existing");
const recordDryRun = args.has("--record-dry-run");
const actorId = getArg("--actor-id", null);
const actorEmail = getArg("--actor-email", "pilot-import@ochiga.local");

function readText(file, required = true) {
  const target = path.join(dataDir, file);
  if (!fs.existsSync(target)) {
    if (required) throw new Error(`Missing required file: ${file}`);
    return "";
  }
  return fs.readFileSync(target, "utf8");
}

function parseCsv(text) {
  if (!text.trim()) return [];
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"' && inQuotes && next === '"') {
      cell += '"';
      i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell);
      if (row.some((v) => String(v).trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((v) => String(v).trim() !== "")) rows.push(row);
  const headers = rows.shift()?.map((h) => h.trim()) || [];
  return rows.map((cols, index) => {
    const out = { __row: index + 2 };
    headers.forEach((h, i) => (out[h] = String(cols[i] ?? "").trim()));
    return out;
  });
}

function jsonFile(file) {
  return JSON.parse(readText(file));
}

function csvFile(file, required = true) {
  return parseCsv(readText(file, required));
}

function required(row, fields, label, errors) {
  for (const field of fields) {
    if (!String(row[field] || "").trim()) errors.push(`${label} row ${row.__row || "?"}: missing ${field}`);
  }
}

function duplicates(rows, key, label, errors) {
  const seen = new Map();
  for (const row of rows) {
    const value = String(row[key] || "").trim().toLowerCase();
    if (!value) continue;
    if (seen.has(value)) errors.push(`${label}: duplicate ${key} '${row[key]}' at rows ${seen.get(value)} and ${row.__row}`);
    seen.set(value, row.__row);
  }
}

function bool(v) {
  return ["true", "1", "yes", "y"].includes(String(v || "").toLowerCase());
}

function nullable(v) {
  const s = String(v ?? "").trim();
  if (!s || /^optional/i.test(s) || /^awaiting/i.test(s)) return null;
  return s;
}

function numberOrNull(v) {
  const s = nullable(v);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ""));
}

const estate = jsonFile("estate.json");
const buildings = csvFile("buildings.csv");
const homes = csvFile("homes.csv");
const rooms = csvFile("rooms.csv", false);
const residents = csvFile("residents.csv");
const cameras = csvFile("cameras.csv");
const zones = csvFile("zones.csv");
const devices = csvFile("devices.csv");
const staff = csvFile("staff.csv");
const accessPoints = csvFile("access_points.csv", false);
const edgeNodes = csvFile("edge_nodes.csv", false);

const errors = [];
const warnings = [];
const estateCode = String(estate.estate_code || "").trim();
if (!estateCode) errors.push("estate.json: missing estate_code");
if (!String(estate.name || "").trim()) errors.push("estate.json: missing name");
if (!String(estate.address || "").trim()) errors.push("estate.json: missing address");

const files = { buildings, homes, rooms, residents, cameras, zones, devices, staff, accessPoints, edgeNodes };
for (const [label, rows] of Object.entries(files)) {
  for (const row of rows) {
    if (String(row.estate_code || "").trim() !== estateCode) {
      errors.push(`${label} row ${row.__row}: estate_code '${row.estate_code}' does not match ${estateCode}`);
    }
  }
}

buildings.forEach((r) => required(r, ["building_ref", "name"], "buildings", errors));
homes.forEach((r) => required(r, ["home_ref", "building_ref", "unit", "name"], "homes", errors));
rooms.forEach((r) => required(r, ["home_ref", "room_ref", "name"], "rooms", errors));
residents.forEach((r) => required(r, ["home_ref", "email", "full_name"], "residents", errors));
cameras.forEach((r) => required(r, ["camera_id", "name", "zone_ref", "status", "health_status"], "cameras", errors));
zones.forEach((r) => required(r, ["zone_ref", "name", "zone_type"], "zones", errors));
devices.forEach((r) => required(r, ["device_ref", "name", "category", "adapter", "external_id"], "devices", errors));
staff.forEach((r) => required(r, ["email", "full_name", "role"], "staff", errors));
accessPoints.forEach((r) => required(r, ["access_point_ref", "name", "access_type", "zone_ref"], "access_points", errors));
edgeNodes.forEach((r) => required(r, ["edge_node_id", "name"], "edge_nodes", errors));

duplicates(buildings, "building_ref", "buildings", errors);
duplicates(homes, "home_ref", "homes", errors);
duplicates(rooms, "room_ref", "rooms", errors);
duplicates(residents, "email", "residents", errors);
duplicates(cameras, "camera_id", "cameras", errors);
duplicates(zones, "zone_ref", "zones", errors);
duplicates(devices, "device_ref", "devices", errors);
duplicates(staff, "email", "staff", errors);
duplicates(accessPoints, "access_point_ref", "access_points", errors);
duplicates(edgeNodes, "edge_node_id", "edge_nodes", errors);

const buildingRefs = new Set(buildings.map((r) => r.building_ref));
const homeRefs = new Set(homes.map((r) => r.home_ref));
const zoneRefs = new Set(zones.map((r) => r.zone_ref));
const roomRefs = new Set(rooms.map((r) => r.room_ref));
for (const row of homes) if (!buildingRefs.has(row.building_ref)) errors.push(`homes row ${row.__row}: building_ref '${row.building_ref}' not found`);
for (const row of rooms) if (!homeRefs.has(row.home_ref)) errors.push(`rooms row ${row.__row}: home_ref '${row.home_ref}' not found`);
for (const row of residents) if (!homeRefs.has(row.home_ref)) errors.push(`residents row ${row.__row}: home_ref '${row.home_ref}' not found`);
for (const row of cameras) if (row.zone_ref && !zoneRefs.has(row.zone_ref)) errors.push(`cameras row ${row.__row}: zone_ref '${row.zone_ref}' not found`);
for (const row of devices) {
  if (row.home_ref && !homeRefs.has(row.home_ref)) errors.push(`devices row ${row.__row}: home_ref '${row.home_ref}' not found`);
  if (row.room_ref && !roomRefs.has(row.room_ref)) errors.push(`devices row ${row.__row}: room_ref '${row.room_ref}' not found`);
  if (row.zone_ref && !zoneRefs.has(row.zone_ref)) errors.push(`devices row ${row.__row}: zone_ref '${row.zone_ref}' not found`);
}
for (const row of accessPoints) if (row.zone_ref && !zoneRefs.has(row.zone_ref)) errors.push(`access_points row ${row.__row}: zone_ref '${row.zone_ref}' not found`);

const summary = {
  mode: apply ? "apply" : "dry-run",
  data_dir: dataDir,
  estate_code: estateCode,
  counts: {
    buildings: buildings.length,
    homes: homes.length,
    rooms: rooms.length,
    residents: residents.length,
    staff: staff.length,
    zones: zones.length,
    access_points: accessPoints.length,
    cameras: cameras.length,
    devices: devices.length,
    edge_nodes: edgeNodes.length,
  },
  warnings,
  errors,
};

async function maybeRecordDryRun() {
  if (!recordDryRun) return;
  const supabaseUrlForAudit = process.env.SUPABASE_URL;
  const serviceKeyForAudit = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrlForAudit || !serviceKeyForAudit) {
    warnings.push("--record-dry-run requested, but SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are missing; audit event not written");
    return;
  }
  const auditDb = createClient(supabaseUrlForAudit, serviceKeyForAudit, { auth: { persistSession: false } });
  const { error } = await auditDb.from("audit_events").insert({
    actor_id: actorId,
    actor_email: actorEmail,
    actor_role: "pilot_importer",
    action: "pilot.import.dry_run",
    resource_type: "pilot_import",
    resource_id: estateCode,
    status: errors.length ? "failed" : "success",
    metadata: summary,
    surface: "pilot-import-script",
  });
  if (error) warnings.push(`dry-run audit write failed: ${error.message}`);
}

if (errors.length || !apply) {
  await maybeRecordDryRun();
  console.log(JSON.stringify({ ok: errors.length === 0, ...summary }, null, 2));
  if (errors.length) process.exit(1);
  process.exit(0);
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error(JSON.stringify({ ok: false, error: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --apply" }, null, 2));
  process.exit(1);
}

const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

async function audit(action, resourceType, resourceId, estateId, metadata = {}, status = "success") {
  await db.from("audit_events").insert({
    actor_id: actorId,
    actor_email: actorEmail,
    actor_role: "pilot_importer",
    action,
    resource_type: resourceType,
    resource_id: resourceId || "",
    estate_id: estateId || null,
    status,
    metadata,
    surface: "pilot-import-script",
  });
}

async function milestone(estateId, milestoneType, title, metadata = {}) {
  const { data, error } = await db.from("deployment_milestones").insert({
    estate_id: estateId,
    milestone_type: milestoneType,
    title,
    status: "recorded",
    actor_id: isUuid(actorId) ? actorId : null,
    metadata,
  }).select("id").single();
  if (error) throw new Error(`deployment_milestones: ${error.message}`);
  await audit("deployment.milestone.created", "deployment_milestone", data?.id, estateId, { milestoneType, title });
}

async function existingBy(table, match) {
  let q = db.from(table).select("*").limit(1);
  Object.entries(match).forEach(([k, v]) => { q = q.eq(k, v); });
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data;
}

const { data: existingEstate, error: existingEstateErr } = await db.from("estates").select("*").eq("name", estate.name).maybeSingle();
if (existingEstateErr) throw new Error(existingEstateErr.message);
if (existingEstate && !allowExisting) {
  console.error(JSON.stringify({ ok: false, error: "Estate already exists. Re-run with --allow-existing only if you intend to append non-duplicate records.", estate_id: existingEstate.id }, null, 2));
  process.exit(1);
}

let estateRow = existingEstate;
if (!estateRow) {
  const { data, error } = await db.from("estates").insert({
    name: estate.name,
    address: estate.address,
    type: estate.type || "estate",
    lat: numberOrNull(estate.lat),
    lng: numberOrNull(estate.lng),
  }).select("*").single();
  if (error) throw new Error(`estates: ${error.message}`);
  estateRow = data;
  await audit("estate.created", "estate", estateRow.id, estateRow.id, { estate_code: estateCode, source: "pilot_import" });
}
const estateId = estateRow.id;
await audit("pilot.import.completed", "estate", estateId, estateId, { stage: "started", summary });
await milestone(estateId, "estate_setup", "Pilot estate import started", { estate_code: estateCode, counts: summary.counts });

const buildingIdByRef = new Map();
for (const row of buildings) {
  const existing = await existingBy("estate_buildings", { estate_id: estateId, building_ref: row.building_ref });
  if (existing && !allowExisting) throw new Error(`Building already exists: ${row.building_ref}`);
  if (existing) { buildingIdByRef.set(row.building_ref, existing.id); continue; }
  const { data, error } = await db.from("estate_buildings").insert({
    estate_id: estateId,
    building_ref: row.building_ref,
    name: row.name,
    block: nullable(row.block),
    floors: numberOrNull(row.floors),
    unit_count: numberOrNull(row.unit_count) || 0,
    building_type: row.building_type || "residential_block",
    status: row.status || "pending",
    metadata: { notes: nullable(row.notes) },
  }).select("id").single();
  if (error) throw new Error(`estate_buildings ${row.building_ref}: ${error.message}`);
  buildingIdByRef.set(row.building_ref, data.id);
}
await milestone(estateId, "building_import", "Buildings imported", { count: buildings.length });

const zoneIdByRef = new Map();
for (const row of zones) {
  const existing = await existingBy("estate_zones", { estate_id: estateId, zone_ref: row.zone_ref });
  if (existing && !allowExisting) throw new Error(`Zone already exists: ${row.zone_ref}`);
  if (existing) { zoneIdByRef.set(row.zone_ref, existing.id); continue; }
  const { data, error } = await db.from("estate_zones").insert({
    estate_id: estateId,
    zone_ref: row.zone_ref,
    name: row.name,
    zone_type: row.zone_type,
    parent_zone_ref: nullable(row.parent_zone_ref),
    description: nullable(row.description),
    metadata: { notes: nullable(row.notes) },
  }).select("id").single();
  if (error) throw new Error(`estate_zones ${row.zone_ref}: ${error.message}`);
  zoneIdByRef.set(row.zone_ref, data.id);
}

const homeIdByRef = new Map();
for (const row of homes) {
  const existing = await existingBy("homes", { estate_id: estateId, unit: row.unit });
  if (existing && !allowExisting) throw new Error(`Home/unit already exists: ${row.unit}`);
  if (existing) { homeIdByRef.set(row.home_ref, existing.id); continue; }
  const { data, error } = await db.from("homes").insert({
    estate_id: estateId,
    name: row.name,
    unit: row.unit,
    block: row.building_ref,
    type: row.type || "home",
    description: nullable(row.notes),
    electricity_meter: nullable(row.electricity_meter),
    water_meter: nullable(row.water_meter),
    internet_id: nullable(row.internet_id),
    gate_code: nullable(row.gate_code),
    lat: numberOrNull(row.lat),
    lng: numberOrNull(row.lng),
  }).select("id").single();
  if (error) throw new Error(`homes ${row.home_ref}: ${error.message}`);
  homeIdByRef.set(row.home_ref, data.id);
}
await milestone(estateId, "unit_import", "Homes/units imported", { count: homes.length });

const roomIdByRef = new Map();
for (const row of rooms) {
  const homeId = homeIdByRef.get(row.home_ref);
  const existing = await existingBy("rooms", { home_id: homeId, name: row.name });
  if (existing && !allowExisting) throw new Error(`Room already exists: ${row.room_ref}`);
  if (existing) { roomIdByRef.set(row.room_ref, existing.id); continue; }
  const { data, error } = await db.from("rooms").insert({
    estate_id: estateId,
    home_id: homeId,
    name: row.name,
    type: nullable(row.type),
    floor: numberOrNull(row.floor),
    ai_profile: { room_ref: row.room_ref, notes: nullable(row.notes) },
  }).select("id").single();
  if (error) throw new Error(`rooms ${row.room_ref}: ${error.message}`);
  roomIdByRef.set(row.room_ref, data.id);
}

for (const row of residents) {
  const homeId = homeIdByRef.get(row.home_ref);
  const { data: user, error: userErr } = await db.from("users").upsert({
    email: row.email.toLowerCase(),
    full_name: row.full_name,
    role: "resident",
    estate_id: estateId,
    home_id: homeId,
  }, { onConflict: "email" }).select("id").single();
  if (userErr) throw new Error(`resident ${row.email}: ${userErr.message}`);
  const { error: estateMemErr } = await db.from("estate_memberships").upsert({ estate_id: estateId, user_id: user.id, role: "resident", status: row.status || "invited" }, { onConflict: "estate_id,user_id" });
  if (estateMemErr) throw new Error(`estate_memberships resident ${row.email}: ${estateMemErr.message}`);
  const { error: homeMemErr } = await db.from("home_memberships").upsert({ home_id: homeId, user_id: user.id, role: "resident", status: row.status || "invited" }, { onConflict: "home_id,user_id" });
  if (homeMemErr) throw new Error(`home_memberships resident ${row.email}: ${homeMemErr.message}`);
}

for (const row of staff) {
  const { data: user, error: userErr } = await db.from("users").upsert({
    email: row.email.toLowerCase(),
    full_name: row.full_name,
    role: row.role || "staff",
    estate_id: estateId,
  }, { onConflict: "email" }).select("id").single();
  if (userErr) throw new Error(`staff ${row.email}: ${userErr.message}`);
  const { error: memErr } = await db.from("estate_memberships").upsert({ estate_id: estateId, user_id: user.id, role: row.role || "staff", status: row.status || "invited" }, { onConflict: "estate_id,user_id" });
  if (memErr) throw new Error(`estate_memberships staff ${row.email}: ${memErr.message}`);
}
await milestone(estateId, "operator_action", "Residents and operators prepared", { residents: residents.length, staff: staff.length });

for (const row of accessPoints) {
  const existing = await existingBy("access_points", { estate_id: estateId, access_point_ref: row.access_point_ref });
  if (existing && !allowExisting) throw new Error(`Access point already exists: ${row.access_point_ref}`);
  if (existing) continue;
  const { error } = await db.from("access_points").insert({
    estate_id: estateId,
    access_point_ref: row.access_point_ref,
    name: row.name,
    access_type: row.access_type || "gate",
    zone_id: zoneIdByRef.get(row.zone_ref) || null,
    location: nullable(row.location),
    status: row.status || "pending",
    metadata: { notes: nullable(row.notes) },
  });
  if (error) throw new Error(`access_points ${row.access_point_ref}: ${error.message}`);
}

for (const row of edgeNodes) {
  const existing = await existingBy("edge_nodes", { estate_id: estateId, edge_node_id: row.edge_node_id });
  if (existing && !allowExisting) throw new Error(`Edge node already exists: ${row.edge_node_id}`);
  if (existing) continue;
  const { data, error } = await db.from("edge_nodes").insert({
    estate_id: estateId,
    edge_node_id: row.edge_node_id,
    name: row.name,
    local_runtime_host: nullable(row.local_runtime_host),
    camera_count: numberOrNull(row.camera_count) || 0,
    device_count: numberOrNull(row.device_count) || 0,
    sync_status: row.sync_status || "awaiting_edge_runtime",
    runtime_version: nullable(row.runtime_version),
    metadata: { notes: nullable(row.notes) },
  }).select("id").single();
  if (error) throw new Error(`edge_nodes ${row.edge_node_id}: ${error.message}`);
  await audit("edge.placeholder.created", "edge_node", data?.id, estateId, { edge_node_id: row.edge_node_id });
}
await milestone(estateId, "edge_runtime_test", "Edge placeholders created", { count: edgeNodes.length });

for (const row of cameras) {
  const existing = await existingBy("facility_cameras", { estate_id: estateId, camera_id: row.camera_id });
  if (existing && !allowExisting) throw new Error(`Camera placeholder already exists: ${row.camera_id}`);
  if (existing) continue;
  const { data, error } = await db.from("facility_cameras").insert({
    estate_id: estateId,
    zone_id: zoneIdByRef.get(row.zone_ref) || null,
    camera_id: row.camera_id,
    name: row.name,
    location: nullable(row.location),
    dvr_nvr_ref: nullable(row.dvr_nvr_ref),
    stream_protocol: row.stream_protocol || "rtsp",
    rtsp_url: null,
    onvif_supported: bool(row.onvif_supported),
    ai_enabled: bool(row.ai_enabled),
    status: row.status || "pending",
    health_status: row.health_status || "pending_stream_details",
    metadata: { rtsp_url_placeholder: row.rtsp_url_placeholder || "AWAITING_STREAM_DETAILS", notes: nullable(row.notes) },
  }).select("id").single();
  if (error) throw new Error(`facility_cameras ${row.camera_id}: ${error.message}`);
  await audit("camera.placeholder.created", "camera", data?.id, estateId, { camera_id: row.camera_id, zone_ref: row.zone_ref });
}
await milestone(estateId, "camera_onboarding", "Camera placeholders created", { count: cameras.length });
await milestone(estateId, "stream_test", "Camera streams awaiting RTSP/HLS validation", { status: "awaiting_stream_details" });
await milestone(estateId, "ai_detection_test", "AI detection awaiting camera analytics provider", { status: "pending_integration" });

for (const row of devices) {
  const existing = await existingBy("devices", { estate_id: estateId, adapter: row.adapter || "placeholder", external_id: row.external_id });
  if (existing && !allowExisting) throw new Error(`Device placeholder already exists: ${row.external_id}`);
  if (existing) continue;
  const { data, error } = await db.from("devices").insert({
    estate_id: estateId,
    home_id: row.home_ref ? homeIdByRef.get(row.home_ref) || null : null,
    room_id: row.room_ref ? roomIdByRef.get(row.room_ref) || null : null,
    name: row.name,
    type: row.category || "placeholder",
    category: row.category,
    provider: nullable(row.provider),
    adapter: row.adapter || "placeholder",
    external_id: row.external_id,
    status: row.status || "pending",
    bind_state: row.home_ref ? "home_bound" : "estate_bound",
    edge_node_id: nullable(row.edge_node_id),
    location: nullable(row.location),
    sync_state: row.sync_state || "pending_integration",
    metadata: { device_ref: row.device_ref, zone_ref: nullable(row.zone_ref), notes: nullable(row.notes) },
  }).select("id").single();
  if (error) throw new Error(`devices ${row.device_ref}: ${error.message}`);
  await audit("device.registered", "device", data?.id, estateId, { placeholder: true, device_ref: row.device_ref });
}
await milestone(estateId, "device_onboarding", "Device placeholders created", { count: devices.length });
await milestone(estateId, "verification_checkpoint", "Pilot import completed", summary.counts);
await audit("pilot.import.completed", "estate", estateId, estateId, { stage: "completed", summary });

console.log(JSON.stringify({ ok: true, ...summary, estate_id: estateId }, null, 2));
