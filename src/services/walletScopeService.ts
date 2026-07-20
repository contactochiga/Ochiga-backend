import type { Request } from "express";
import { resolveOisContext } from "./context/contextResolutionService";
import { requestInput } from "../middleware/contextResolver";
import { supabaseAdmin } from "../supabase/supabaseClient";

type WalletScope = {
  userId: string;
  estateId: string | null;
  homeId: string | null;
  membershipId: string | null;
};

function text(value: unknown) {
  const next = String(value ?? "").trim();
  return next || null;
}

function missingColumn(error: any, column: string) {
  return String(error?.message || "").toLowerCase().includes(column.toLowerCase());
}

async function activeHomeMembershipId(userId: string, homeId: string | null) {
  if (!userId || !homeId) return null;
  const { data, error } = await supabaseAdmin
    .from("home_memberships")
    .select("id")
    .eq("user_id", userId)
    .eq("home_id", homeId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return text((data as any)?.id);
}

export async function resolveWalletScopeFromRequest(req: Request): Promise<WalletScope> {
  const user = req.user;
  if (!user?.id) throw Object.assign(new Error("Authentication required"), { statusCode: 401 });
  const context = req.oisContext || await resolveOisContext(user, requestInput(req));
  const homeId = text(context.home_id);
  const estateId = text(context.estate_id);
  if (!homeId) throw Object.assign(new Error("Active home context is required"), { statusCode: 400 });
  const membershipId = await activeHomeMembershipId(String(user.id), homeId);
  return {
    userId: String(user.id),
    estateId,
    homeId,
    membershipId,
  };
}

export async function resolveWalletScopeForHome(input: { userId: string; estateId?: string | null; homeId?: string | null }): Promise<WalletScope> {
  const userId = String(input.userId || "").trim();
  const homeId = text(input.homeId);
  if (!userId) throw Object.assign(new Error("Authentication required"), { statusCode: 401 });
  if (!homeId) {
    return { userId, estateId: text(input.estateId), homeId: null, membershipId: null };
  }
  const membershipId = await activeHomeMembershipId(userId, homeId);
  return {
    userId,
    estateId: text(input.estateId),
    homeId,
    membershipId,
  };
}

export async function getOrCreateScopedWallet(scope: WalletScope) {
  const userId = text(scope.userId);
  if (!userId) throw new Error("wallet_user_required");

  if (scope.homeId) {
    let { data, error } = await supabaseAdmin
      .from("wallets")
      .select("*")
      .eq("user_id", userId)
      .eq("home_id", scope.homeId)
      .maybeSingle();

    if (error && missingColumn(error, "home_id")) {
      const legacy = await supabaseAdmin
        .from("wallets")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      data = legacy.data as any;
      error = legacy.error as any;
    }
    if (error) throw error;
    if (data?.id) return data;
  } else {
    const { data, error } = await supabaseAdmin
      .from("wallets")
      .select("*")
      .eq("user_id", userId)
      .is("home_id", null)
      .maybeSingle();
    if (!error && data?.id) return data;
  }

  let payload: Record<string, any> = {
    user_id: userId,
    estate_id: scope.estateId || null,
    home_id: scope.homeId || null,
    membership_id: scope.membershipId || null,
    balance: 0,
    currency: "NGN",
    metadata: { scope: scope.homeId ? "home" : "global" },
    updated_at: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, error } = await supabaseAdmin
      .from("wallets")
      .insert([payload])
      .select("*")
      .maybeSingle();
    if (!error) return data;
    let pruned = false;
    for (const column of ["estate_id", "home_id", "membership_id", "metadata", "updated_at"]) {
      if (missingColumn(error, column) && Object.prototype.hasOwnProperty.call(payload, column)) {
        delete payload[column];
        pruned = true;
      }
    }
    if (pruned) continue;
    if (/duplicate key|unique/i.test(String(error?.message || ""))) {
      const query = supabaseAdmin.from("wallets").select("*").eq("user_id", userId);
      const read = scope.homeId
        ? await query.eq("home_id", scope.homeId).maybeSingle()
        : await query.maybeSingle();
      if (!read.error && read.data?.id) return read.data;
    }
    throw error;
  }

  throw new Error("wallet_create_failed");
}
