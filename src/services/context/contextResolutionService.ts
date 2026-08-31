import type { AuthUser } from "../../middleware/auth";
import { supabaseAdmin } from "../../supabase/supabaseClient";
import type { OisContext, OisContextEstate, OisContextHome, OisSurface, OyiTarget } from "../../types/oisContext";

export type ContextResolutionInput = {
  surface?: OisSurface | string | null;
  estate_id?: string | null;
  home_id?: string | null;
  module?: string | null;
  target?: OyiTarget | null;
};

export class ContextResolutionError extends Error {
  constructor(message: string, readonly statusCode = 403) {
    super(message);
  }
}

const clean = (value: unknown) => String(value || "").trim() || null;

function surfaceFor(value: unknown): OisSurface {
  const candidate = String(value || "consumer").trim().toLowerCase();
  return ["consumer", "facility", "office", "command_center", "watch", "edge"].includes(candidate)
    ? candidate as OisSurface
    : "consumer";
}

// Production incident: these used to select via PostgREST's embedded-
// relation syntax (estate_memberships.select("estate_id,role,estates(id,
// name)")) and destructure only `{ data }`, discarding `error`. Two
// compounding defects: (1) any query failure was silently indistinguish-
// able from "this user has zero memberships", producing exactly the
// reported symptoms ("join an estate" on Community, a 403 on
// POST /maintenance) for a resident whose estate_memberships/
// home_memberships rows were 100% correct and active -- confirmed
// directly against production; (2) Profile's own membership check
// (getResidentVerificationContext, src/routes/me.routes.ts) queries the
// SAME tables for the SAME user with a flat, non-embedded
// `.select("role,status")` and succeeds where this embedded query did
// not -- strong evidence the embedded-relation shape itself was the
// less reliable path in this environment, not just an unlucky one-off.
// Rewritten below to the same flat, two-step shape Profile's check
// already uses successfully: fetch the membership rows, then fetch the
// referenced estates/homes by id. Never swallow the error either way.
async function availableEstates(actor: AuthUser): Promise<OisContextEstate[]> {
  const { data: memberships, error: membershipError } = await supabaseAdmin
    .from("estate_memberships")
    .select("estate_id,role")
    .eq("user_id", actor.id)
    .eq("status", "active");
  if (membershipError) throw new ContextResolutionError(`Unable to resolve estate memberships: ${membershipError.message}`, 500);

  const roleByEstateId = new Map<string, string | null>();
  const estateIds: string[] = [];
  for (const row of memberships || []) {
    const id = String((row as any)?.estate_id || "");
    if (!id) continue;
    if (!roleByEstateId.has(id)) estateIds.push(id);
    roleByEstateId.set(id, (row as any)?.role ?? null);
  }

  const rows: OisContextEstate[] = [];
  if (estateIds.length) {
    const { data: estates, error: estatesError } = await supabaseAdmin.from("estates").select("id,name").in("id", estateIds);
    if (estatesError) throw new ContextResolutionError(`Unable to resolve estates: ${estatesError.message}`, 500);
    for (const estate of estates || []) {
      const id = String((estate as any)?.id || "");
      if (!id) continue;
      rows.push({ id, name: (estate as any)?.name || null, role: roleByEstateId.get(id) ?? null });
    }
  }

  if (actor.estate_id && !rows.some((estate) => estate.id === String(actor.estate_id))) {
    const { data: estate, error } = await supabaseAdmin.from("estates").select("id,name").eq("id", actor.estate_id).maybeSingle();
    if (error) throw new ContextResolutionError(`Unable to resolve estate ${actor.estate_id}: ${error.message}`, 500);
    if (estate?.id) rows.push({ id: String(estate.id), name: estate.name || null, role: actor.role });
  }
  return rows;
}

async function availableHomes(actor: AuthUser): Promise<OisContextHome[]> {
  const { data: memberships, error: membershipError } = await supabaseAdmin
    .from("home_memberships")
    .select("id,home_id")
    .eq("user_id", actor.id)
    .eq("status", "active");
  if (membershipError) throw new ContextResolutionError(`Unable to resolve home memberships: ${membershipError.message}`, 500);

  const membershipIdByHomeId = new Map<string, string | null>();
  const homeIds: string[] = [];
  for (const row of memberships || []) {
    const id = String((row as any)?.home_id || "");
    if (!id) continue;
    if (!membershipIdByHomeId.has(id)) homeIds.push(id);
    membershipIdByHomeId.set(id, (row as any)?.id ? String((row as any).id) : null);
  }
  if (!homeIds.length) return [];

  const { data: homes, error: homesError } = await supabaseAdmin
    .from("homes")
    .select("id,name,block,unit,estate_id,electricity_meter,water_meter,internet_id,gate_code")
    .in("id", homeIds);
  if (homesError) throw new ContextResolutionError(`Unable to resolve homes: ${homesError.message}`, 500);

  return (homes || []).map((home: any) => ({
    id: String(home.id),
    membership_id: membershipIdByHomeId.get(String(home.id)) ?? null,
    name: home.name || null,
    block: home.block || null,
    unit: home.unit || null,
    estate_id: String(home.estate_id || ""),
    electricity_meter: home.electricity_meter || null,
    water_meter: home.water_meter || null,
    internet_id: home.internet_id || null,
    gate_code: home.gate_code || null,
  }));
}

async function facilityHome(homeId: string, estateIds: Set<string>): Promise<OisContextHome | null> {
  const { data } = await supabaseAdmin.from("homes").select("id,name,block,unit,estate_id,electricity_meter,water_meter,internet_id,gate_code").eq("id", homeId).maybeSingle();
  if (!data?.id || !estateIds.has(String(data.estate_id))) return null;
  return { id: String(data.id), name: data.name || null, block: data.block || null, unit: data.unit || null, estate_id: String(data.estate_id), electricity_meter: data.electricity_meter || null, water_meter: data.water_meter || null, internet_id: data.internet_id || null, gate_code: data.gate_code || null };
}

export async function resolveOisContext(actor: AuthUser, input: ContextResolutionInput = {}): Promise<OisContext> {
  if (!actor?.id) throw new ContextResolutionError("Authentication required", 401);
  const surface = surfaceFor(input.surface);
  const [memberEstates, homes] = await Promise.all([availableEstates(actor), availableHomes(actor)]);
  const estates = [...memberEstates];
  const homeEstateIds = Array.from(new Set(homes.map((home) => home.estate_id).filter(Boolean)));
  const missingEstateIds = homeEstateIds.filter((id) => !estates.some((estate) => estate.id === id));
  if (missingEstateIds.length) {
    const { data } = await supabaseAdmin.from("estates").select("id,name").in("id", missingEstateIds);
    for (const estate of data || []) estates.push({ id: String(estate.id), name: estate.name || null, role: "resident" });
  }
  const estateIds = new Set(estates.map((estate) => estate.id));
  const requestedEstateId = clean(input.estate_id);
  const requestedHomeId = clean(input.home_id);

  let home = requestedHomeId ? homes.find((item) => item.id === requestedHomeId) || null : null;
  if (!home && requestedHomeId && surface === "facility") home = await facilityHome(requestedHomeId, estateIds);
  if (requestedHomeId && !home) throw new ContextResolutionError("The requested home is not available in your operating scope");

  const defaultHome = homes.find((item) => item.id === String(actor.home_id || "")) || null;
  if (!home && surface === "consumer") home = defaultHome;

  const derivedEstateId = home?.estate_id || null;
  const activeEstateId = requestedEstateId || derivedEstateId || (estateIds.has(String(actor.estate_id || "")) ? String(actor.estate_id) : null);
  if (activeEstateId && !estateIds.has(activeEstateId)) throw new ContextResolutionError("The requested estate is not available in your operating scope");
  if (requestedEstateId && home && home.estate_id !== requestedEstateId) throw new ContextResolutionError("The requested home does not belong to the requested estate");

  return {
    actor_id: actor.id,
    surface,
    role: actor.role,
    permissions: Array.isArray(actor.permissions) ? actor.permissions : [],
    organization_id: null,
    portfolio_id: null,
    account_id: null,
    deployment_id: null,
    estate_id: activeEstateId,
    home_id: home?.id || null,
    membership_id: home?.membership_id || null,
    module: clean(input.module),
    target: input.target || null,
    estate: estates.find((estate) => estate.id === activeEstateId) || null,
    home,
    available_estates: estates,
    available_homes: homes,
    resolved_at: new Date().toISOString(),
  };
}
