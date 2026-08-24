import assert from "node:assert/strict";
import fs from "node:fs";

const route=fs.readFileSync(new URL("../src/routes/edgeDiscovery.ts",import.meta.url),"utf8");
const gateway=fs.readFileSync(new URL("../src/modules/cameras/cameraGateway.ts",import.meta.url),"utf8");
const realtime=fs.readFileSync(new URL("../src/realtime/emitSignal.ts",import.meta.url),"utf8");
const scan=fs.readFileSync(new URL("../src/controllers/camerasController.ts",import.meta.url),"utf8");
const migration=fs.readFileSync(new URL("../supabase/migrations/20260824150000_camera_gateway_phase3.sql",import.meta.url),"utf8");

assert.match(route,/requireEdgeToken[\s\S]*pendingEdgeCommands/);
assert.match(route,/requirePermission\("cameras\.manage"\)/);
assert.match(route,/Legacy pushes remain candidate-only/);
assert.match(route,/canonical_camera_id/);
assert.match(route,/\.eq\("edge_node_id", agentId\)/);
assert.doesNotMatch(route,/cryptoRandomId/);
assert.match(gateway,/PRIVATE_IP/);
const publicProjection=gateway.split("export function publicDiscoveryCandidate")[1];
assert(publicProjection && !publicProjection.includes("ipAddress:") && !publicProjection.includes("xaddrIdentity:"),"public candidate must hide LAN coordinates");
assert.match(realtime,/if \(!scoped\) io\.emit/);
assert.match(realtime,/home:\$\{homeId\}/);
assert.doesNotMatch(scan,/ALLOW_CLOUD_CAMERA_SCAN/);
assert.match(migration,/create table if not exists public\.edge_commands/);
assert.match(migration,/revoke all on public\.discovered_devices from anon, authenticated/);
console.log("camera gateway phase3 smoke: ok");
