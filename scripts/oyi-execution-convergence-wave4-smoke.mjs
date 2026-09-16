#!/usr/bin/env node
// Oyi Intelligence Convergence, Wave 4 -- Action & Execution Convergence,
// first migrated bypass. Real behavioral coverage of the NEW explicit
// authority gate (authorizeDeviceCommand(), DeviceCommandAuthority.ts)
// this wave inserted into requestDeviceCommand() -- the direct HTTP
// device-command bypass identified by the Wave 4 execution-path audit
// (deviceCommandController.ts, mounted at POST /devices/:deviceId/command,
// POST /facility/devices/:deviceId/command, POST /signals/device/:deviceId/command).
//
// This exercises the REAL, compiled capabilityService.canUse() decision
// (not a re-derived approximation of it) against the SAME
// "devices.power.control" capability every canonical device action path
// (the conversational confirm-turn, Spatial Mode) already authorizes
// against -- proving "I resolved a device by ID" is no longer sufficient
// to control it.
//
// The full canonical chain this capability feeds into (capability ->
// durable OyiWorkflow -> durable OyiAction -> DeviceConversationActionAdapter
// -> executeDeviceCommandForActor -> verification -> confirmed/unobservable
// terminal state, idempotent create, confirmation-required behaviour) is
// ALREADY proven end-to-end by scripts/facility-spatial-device-action-smoke.mjs
// against this exact capability -- not duplicated here. This file proves
// specifically what Wave 4 added: the authority gate's real allow/deny
// decisions, and that requestDeviceCommand() is actually wired to consult
// it before any physical execution.
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "local-smoke-service-role-key";

import { readFileSync } from "node:fs";

const { authorizeDeviceCommand, DEVICE_COMMAND_CAPABILITY_KEY } = await import("../dist/oyi-core/actions/DeviceCommandAuthority.js");

const failures = [];
function need(condition, message) {
  if (!condition) failures.push(message);
}

need(DEVICE_COMMAND_CAPABILITY_KEY === "devices.power.control", "must reuse the real, production-registered devices.power.control capability, not a new one");

// A. Authorized resident actor, device's home matches the actor's own
// home -- allowed.
const residentActor = { id: "actor-resident-1", role: "resident", home_id: "home-1", estate_id: "estate-1", permissions: ["devices.control"] };
const authorizedResident = authorizeDeviceCommand({ actor: residentActor, commandSource: "app", estateId: "estate-1", homeId: "home-1", roomId: null });
need(authorizedResident.allowed === true, `A. authorized resident actor must be allowed, got: ${JSON.stringify(authorizedResident)}`);

// B. Actor missing the devices.control permission entirely -- denied,
// never reaches physical execution. This is the exact "I know the device
// ID is not authority" gap the Wave 4 audit identified.
const noPermissionActor = { id: "actor-no-permission", role: "guest", home_id: "home-1", estate_id: "estate-1", permissions: [] };
const deniedNoPermission = authorizeDeviceCommand({ actor: noPermissionActor, commandSource: "app", estateId: "estate-1", homeId: "home-1", roomId: null });
need(deniedNoPermission.allowed === false, "B. actor without devices.control must be denied");
need(deniedNoPermission.reason === "missing_permission", `B. denial reason must be missing_permission, got: ${deniedNoPermission.reason}`);
need(deniedNoPermission.required_permissions.includes("devices.control"), "B. required_permissions must list devices.control");

// C. Resident actor with devices.control, but the device's home differs
// from the actor's own home -- wrong-scope denial, not a permission gap.
const wrongHomeActor = { id: "actor-wrong-home", role: "resident", home_id: "home-1", estate_id: "estate-1", permissions: ["devices.control"] };
const deniedWrongHome = authorizeDeviceCommand({ actor: wrongHomeActor, commandSource: "app", estateId: "estate-1", homeId: "home-2", roomId: null });
need(deniedWrongHome.allowed === false, "C. resident actor targeting a different home's device must be denied");
need(deniedWrongHome.reason === "home_scope_not_owned_by_actor", `C. denial reason must be home_scope_not_owned_by_actor, got: ${deniedWrongHome.reason}`);

// D. No home scope resolvable at all -- devices.power.control's
// scope_requirements mandate home scope; must be denied, not silently
// allowed.
const deniedNoScope = authorizeDeviceCommand({ actor: residentActor, commandSource: "app", estateId: "estate-1", homeId: null, roomId: null });
need(deniedNoScope.allowed === false, "D. missing home scope must be denied");
need(deniedNoScope.reason === "home_scope_required", `D. denial reason must be home_scope_required, got: ${deniedNoScope.reason}`);

// E. Facility-surface caller (operator role, source "facility") is a
// supported surface for this capability -- allowed when otherwise
// authorized, proving the facility route mount point is not silently
// broken by the new gate.
const facilityActor = { id: "actor-facility-1", role: "facility_operator", home_id: null, estate_id: "estate-1", permissions: ["devices.control"] };
const authorizedFacility = authorizeDeviceCommand({ actor: facilityActor, commandSource: "facility", estateId: "estate-1", homeId: "home-9", roomId: null });
need(authorizedFacility.allowed === true, `E. authorized facility-surface actor must be allowed, got: ${JSON.stringify(authorizedFacility)}`);

// F. Structural proof requestDeviceCommand() is actually wired to this
// gate, that the gate runs before EITHER physical-execution call site
// (the IR ack-only branch and the standard async branch), and that a
// denial returns before dispatch -- source-text assertions, matching
// this repo's established convention for controller-level wiring proof
// (see e.g. scripts/smart-access-runtime-smoke.mjs's own regex assertion
// against this same file) rather than standing up a full live HTTP +
// Supabase device fixture for a 1741-line hardened production controller.
const controllerSource = readFileSync(new URL("../src/controllers/deviceCommandController.ts", import.meta.url), "utf8");
need(controllerSource.includes('import { authorizeDeviceCommand } from "../oyi-core/actions/DeviceCommandAuthority";'), "F. requestDeviceCommand's controller must import authorizeDeviceCommand");

const fnStart = controllerSource.indexOf("export async function requestDeviceCommand(");
need(fnStart > 0, "F. requestDeviceCommand function must exist");
const fnBody = controllerSource.slice(fnStart, controllerSource.indexOf("\nexport async function", fnStart + 1) === -1 ? controllerSource.length : controllerSource.indexOf("\nexport async function", fnStart + 1));

const resolveIdx = fnBody.indexOf("resolveCommandTarget({");
const authorityCallIdx = fnBody.indexOf("authorizeDeviceCommand({");
const authorityDenyReturnIdx = fnBody.indexOf("status(403).json({");
const irExecuteIdx = fnBody.indexOf("if (providerAckOnly) {");
const asyncExecuteIdx = fnBody.indexOf("void executeDeviceCommandForActor({");

need(resolveIdx > 0 && authorityCallIdx > resolveIdx, "F. authority gate must run after the device target is resolved");
need(authorityDenyReturnIdx > authorityCallIdx && authorityDenyReturnIdx < authorityCallIdx + 800, "F. a 403 response must immediately follow the authority decision");
need(authorityCallIdx < irExecuteIdx, "F. the authority gate must run before the IR ack-only execution branch");
need(authorityCallIdx < asyncExecuteIdx, "F. the authority gate must run before the standard async execution branch");
need(irExecuteIdx > 0 && asyncExecuteIdx > 0, "F. sanity: both known execution branches must still exist unmodified");

// Route-level permission gates remain as defence in depth -- the
// capability gate is additive authority, not a replacement for the
// existing requirePermission("devices.control") checks.
const devicesRoute = readFileSync(new URL("../src/routes/devices.ts", import.meta.url), "utf8");
const facilityRoute = readFileSync(new URL("../src/routes/facilityDevices.routes.ts", import.meta.url), "utf8");
const signalsRoute = readFileSync(new URL("../src/routes/signals.ts", import.meta.url), "utf8");
// devices.ts and facilityDevices.routes.ts wire requestDeviceCommand
// directly as route middleware; signals.ts's /device/:deviceId/command
// alias wires an inline handler that normalizes the body and then calls
// requestDeviceCommand(req, res) itself -- both patterns are valid
// "still gated by devices.control before reaching requestDeviceCommand",
// so accept either shape.
for (const [name, source] of [["devices.ts", devicesRoute], ["facilityDevices.routes.ts", facilityRoute], ["signals.ts", signalsRoute]]) {
  const direct = /requirePermission\(\s*["']devices\.control["']\s*\)\s*,\s*requestDeviceCommand/.test(source);
  const viaInlineHandler = /requirePermission\(\s*["']devices\.control["']\s*\)\s*,\s*\([^)]*\)\s*=>\s*\{[\s\S]{0,400}?requestDeviceCommand\(/.test(source);
  need(direct || viaInlineHandler, `F. ${name} must still gate requestDeviceCommand with requirePermission("devices.control") as defence in depth`);
}

if (failures.length) {
  console.error("FAILURES:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}

console.log("PASS explicit authority gate allows a correctly-scoped, permitted actor");
console.log("PASS explicit authority gate denies an actor without devices.control (never reaches physical execution)");
console.log("PASS explicit authority gate denies wrong-home-scope access to another home's device");
console.log("PASS explicit authority gate denies when no home scope is resolvable at all");
console.log("PASS facility-surface callers remain authorized through the same gate");
console.log("PASS requestDeviceCommand is wired to the authority gate before both the IR and standard execution branches");
console.log("PASS existing route-level permission gates remain intact as defence in depth");
console.log("oyi-execution-convergence-wave4-smoke passed");
