#!/usr/bin/env node
// Wave 4B -- Intelligence Convergence, Slice 2. Closes the scheduler's
// dormant counterpart to Slice 1's Office automation-test bypass:
// automationSchedulerTick -> claimAndRunAutomation -> executeConsumerAutomation
// could reach the same plain device-command lane for surface === "office"
// automations without the Slice 1 authority gate. AUTOMATION_SURFACE_OFFICE_ENABLED
// is false today, so this was never a live reachable bypass -- this slice
// makes it safe by construction before that flag can ever be turned on.
//
// No second authority actor builder, no second permission model: the
// gate this slice relies on is the EXACT SAME code Slice 1 added inside
// executeConsumerAutomation (scenes.ts), keyed off the same
// officeDeviceCommandAuthority opt-in. Slice 2's entire change is a
// single call-site edit: claimAndRunAutomation now passes
// officeDeviceCommandAuthority: surface === "office" into that shared
// function, exactly mirroring how officeExport.ts's test route opts in.
// officeAutomationActor()/role: "ochiga_admin" is still used only for
// actor identity/audit attribution in the scheduler path -- it is never
// passed to the authority decision, same separation Slice 1 established.
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "wave4b-slice2-smoke-service-role-key";

import { readFileSync } from "node:fs";

const { authorizeDeviceCommand } = await import("../dist/oyi-core/actions/DeviceCommandAuthority.js");
const { isAutomationSurfaceEnabled } = await import("../dist/routes/scenes.js");

const failures = [];
function need(condition, message) {
  if (!condition) failures.push(message);
}

const scenesSource = readFileSync(new URL("../src/routes/scenes.ts", import.meta.url), "utf8");
const officeExportSource = readFileSync(new URL("../src/routes/officeExport.ts", import.meta.url), "utf8");

// ============================= 1. Office surface disabled -> rows never claimed =============================

// Functional: with no AUTOMATION_SURFACE_OFFICE_ENABLED env override
// (this smoke's process never sets it), the real compiled
// isAutomationSurfaceEnabled() must report office as disabled -- the
// exact same function both automationSchedulerTick's due-scan and
// claimAndRunAutomation's defense-in-depth check call.
need(isAutomationSurfaceEnabled("office") === false, "1. isAutomationSurfaceEnabled('office') must be false by default (AUTOMATION_SURFACE_OFFICE_ENABLED unset) -- this slice does not enable it");
need(isAutomationSurfaceEnabled("consumer") === true, "1. sanity: consumer surface must remain enabled");

// Structural: the tick's due-scan filters by enabledAutomationSurfaces()
// BEFORE any row is even fetched, and claimAndRunAutomation repeats the
// check per-row as defense in depth -- two independent gates, neither
// touched by this slice, both still present.
const tickStart = scenesSource.indexOf("async function automationSchedulerTick()");
need(tickStart > 0, "1. automationSchedulerTick must exist");
const tickBody = scenesSource.slice(tickStart, scenesSource.indexOf("\nasync function claimAndRunAutomation", tickStart));
need(tickBody.includes("const surfaces = enabledAutomationSurfaces();") && tickBody.includes('.in("surface", surfaces)'), "1. the due-scan query must filter by enabledAutomationSurfaces() before any row is fetched");

const claimStart = scenesSource.indexOf("async function claimAndRunAutomation(automation: any) {");
need(claimStart > 0, "1. claimAndRunAutomation must exist");
const claimEnd = scenesSource.indexOf("\n// Automation Workspace UI/UX completion", claimStart);
const claimBody = scenesSource.slice(claimStart, claimEnd > 0 ? claimEnd : scenesSource.length);
need(claimBody.includes("if (!isAutomationSurfaceEnabled(surface)) {") && claimBody.indexOf("if (!isAutomationSurfaceEnabled(surface)) {") < claimBody.indexOf("executeConsumerAutomation"), "1. claimAndRunAutomation's defense-in-depth surface check must run before executeConsumerAutomation is ever called");

// ============================= 2/4. Office-surface scheduled run cannot reach device execution without the authority gate =============================

need(claimBody.includes("officeDeviceCommandAuthority: surface === \"office\","), "2. claimAndRunAutomation must opt executeConsumerAutomation into the authority gate specifically when surface === 'office'");

// The gate itself (inside executeConsumerAutomation, shared with Slice 1)
// must still run, and any denial must still return, before
// executeResidentActionBatch -- re-verified here as a direct regression
// proof that Slice 2's edit did not disturb Slice 1's placement.
const fnStart = scenesSource.indexOf("export async function executeConsumerAutomation(");
const fnEnd = scenesSource.indexOf("\nlet automationScheduler", fnStart);
const fnBody = scenesSource.slice(fnStart, fnEnd > 0 ? fnEnd : scenesSource.length);
const gateIdx = fnBody.indexOf("if (input.officeDeviceCommandAuthority) {");
const authorityCallIdx = fnBody.indexOf("authorizeDeviceCommand({");
const denyReturnIdx = fnBody.indexOf("return { ...runRow, ...failed };", authorityCallIdx);
const executeResidentIdx = fnBody.lastIndexOf("results = await executeResidentActionBatch({");
need(gateIdx > 0 && authorityCallIdx > gateIdx && executeResidentIdx > authorityCallIdx, "4. the authority decision must still run before executeResidentActionBatch (physical dispatch)");
need(denyReturnIdx > authorityCallIdx && denyReturnIdx < executeResidentIdx, "4. a denial must still return before executeResidentActionBatch is ever reached");

// claimAndRunAutomation itself must never call executeResidentActionBatch
// or executeDeviceCommandForActor directly -- all scheduled dispatch,
// office or otherwise, is delegated through the one gated function.
need(!claimBody.includes("executeResidentActionBatch") && !claimBody.includes("executeDeviceCommandForActor"), "4. claimAndRunAutomation must not call the device-dispatch chain directly -- it must delegate exclusively through the gated executeConsumerAutomation");

// ============================= 3. Missing persisted scope fails closed =============================

const scopedButNoHome = {
  id: "office_automation_device_authority",
  role: "ai_agent",
  permissions: ["devices.control"],
  permission_scopes: [],
  estate_id: "estate-1",
  home_id: null,
};
const deniedMissingScope = authorizeDeviceCommand({ actor: scopedButNoHome, commandSource: "office_automation", estateId: "estate-1", homeId: null, roomId: null });
need(deniedMissingScope.allowed === false && deniedMissingScope.reason === "home_scope_required", `3. a scheduled office automation with no persisted home_id must fail closed (home_scope_required), got: ${JSON.stringify(deniedMissingScope)}`);

// ============================= 5. Authorized office automation preserves existing execution semantics =============================

const honestOfficeActor = { id: "office_automation_device_authority", role: "ai_agent", permissions: ["devices.control"], permission_scopes: [], estate_id: "estate-1", home_id: "home-1" };
const allowed = authorizeDeviceCommand({ actor: honestOfficeActor, commandSource: "office_automation", estateId: "estate-1", homeId: "home-1", roomId: null });
need(allowed.allowed === true, "5. a properly scoped+permissioned scheduled office automation must still be allowed through");

// The new flag must be purely additive to the scheduler's existing call
// -- scheduledFor/occurrenceKey/automation/actor/req/source are all
// still passed exactly as before, only one new field appended.
const schedulerCallIdx = scenesSource.indexOf("await executeConsumerAutomation({\n    automation: claim.data,\n    actor,\n    req,\n    source: \"scheduled\",\n    scheduledFor,\n    occurrenceKey,");
need(schedulerCallIdx > 0, "5. the scheduler's executeConsumerAutomation call must still pass every pre-existing field (automation, actor, req, source: 'scheduled', scheduledFor, occurrenceKey) unchanged");

// ============================= 6. Consumer-surface scheduler behaviour is unchanged =============================

// The flag is a derived boolean (surface === "office"), not a hardcoded
// true -- for every consumer/facility scheduled run it evaluates false,
// and the actor-resolution branch that fetches a real users row for
// non-office surfaces is untouched.
need(claimBody.includes('officeDeviceCommandAuthority: surface === "office",'), "6. the flag must be derived from the real automation surface, not hardcoded true -- consumer/facility runs must evaluate it false");
need(claimBody.includes('const { data } = await supabaseAdmin.from("users").select("*").eq("id", automation.created_by).maybeSingle();'), "6. non-office actor resolution (real Backend user lookup) must be unchanged");

// ============================= 7. Slice 1's officeExport.ts authority boundary remains intact =============================

need(officeExportSource.includes("officeDeviceCommandAuthority: true"), "7. officeExport.ts's automation-test route must still opt into the authority gate -- Slice 1 boundary unmodified");
need(officeExportSource.includes("requireOfficeExportKey"), "7. sanity: the Office shared-key gate must still exist");

// ============================= 8. No fabricated ochiga_admin execution authority is introduced =============================

// The gate's authority actor (inside executeConsumerAutomation, shared
// by both entrances) must be the narrow ai_agent+devices.control actor,
// never officeAutomationActor()'s role: "ochiga_admin". This block is
// untouched by Slice 2 -- re-verified here as a direct regression proof.
const gateBlock = fnBody.slice(gateIdx, executeResidentIdx);
need(gateBlock.includes('role: "ai_agent"') && gateBlock.includes('permissions: ["devices.control"]'), "8. the authority actor must be the narrow ai_agent+devices.control construction, not a blanket role");
need(!gateBlock.includes('role: "ochiga_admin"') && !gateBlock.includes("officeAutomationActor("), "8. the authority decision must never be based on officeAutomationActor()'s ochiga_admin identity");
// claimAndRunAutomation's own actor resolution keeps using
// officeAutomationActor() for identity/audit attribution ONLY -- that
// variable is never the one passed into authorizeDeviceCommand (it lives
// inside executeConsumerAutomation's own gate, which builds its own
// separate actor object, never receiving `actor` as input at all).
need(claimBody.includes("actor = officeAutomationActor(automation);"), "8. officeAutomationActor() must still be used for scheduler actor/audit identity (unchanged, distinct concern from authority)");
need(!authorityCallIdxUsesSchedulerActor(fnBody), "8. the authority call must never reference the function's own `actor` parameter -- it builds an isolated authority actor");

function authorityCallIdxUsesSchedulerActor(body) {
  const callStart = body.indexOf("authorizeDeviceCommand({");
  const callEnd = body.indexOf("});", callStart);
  const callText = body.slice(callStart, callEnd);
  return /actor:\s*actor\b/.test(callText);
}

// ============================= 9. Exactly the known call sites of executeConsumerAutomation exist -- no new entrances =============================

const callSiteMatches = [...scenesSource.matchAll(/executeConsumerAutomation\(\{/g)].length + [...officeExportSource.matchAll(/executeConsumerAutomation\(\{/g)].length;
need(callSiteMatches === 3, `9. exactly 3 executeConsumerAutomation call sites must exist (scheduler, scenes.ts consumer test route, officeExport.ts test route) -- found ${callSiteMatches}, a new count would mean an undiscovered entrance`);

if (failures.length) {
  console.error("FAILURES:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}

console.log("PASS office automation surface is disabled by default -- both scheduler gates (due-scan filter + defense-in-depth check) intact");
console.log("PASS claimAndRunAutomation opts executeConsumerAutomation into the authority gate specifically for surface === 'office'");
console.log("PASS a scheduled office automation with missing persisted home scope fails closed (home_scope_required)");
console.log("PASS the authority gate still runs, and any denial still returns, before executeResidentActionBatch/provider dispatch");
console.log("PASS claimAndRunAutomation never calls the device-dispatch chain directly -- all dispatch delegates through the gated function");
console.log("PASS a properly authorized scheduled office automation is still allowed through, with all pre-existing scheduler fields preserved");
console.log("PASS the new flag is a derived surface === 'office' boolean -- consumer/facility scheduled behaviour is unchanged");
console.log("PASS officeExport.ts's Slice 1 automation-test authority boundary remains intact");
console.log("PASS no fabricated ochiga_admin execution authority is introduced -- the authority actor stays the narrow ai_agent+devices.control construction, isolated from the scheduler's own identity actor");
console.log("PASS no undiscovered executeConsumerAutomation entrance exists");
console.log("wave4b-slice2-office-automation-scheduler-authority-smoke passed");
// Importing dist/routes/scenes.js pulls in a Redis client that leaves a
// lingering reconnect handle open after these assertions complete (same
// known issue documented in communication-automation-action-smoke.mjs
// and office-export-auth-compat-smoke.mjs) -- does not affect
// correctness, just process exit.
process.exit(0);
