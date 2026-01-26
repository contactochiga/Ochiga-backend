// src/services/userVerificationService.ts
import { supabaseAdmin } from "../supabase/supabaseClient";

function cleanEmail(email: string) {
  return String(email || "").trim().toLowerCase();
}

function isConfirmed(user: any) {
  // Gotrue fields differ by version; support both.
  return Boolean(user?.email_confirmed_at || user?.confirmed_at);
}

/**
 * Supabase Admin API (in your SDK) does NOT expose getUserByEmail.
 * So we page through listUsers() and match email.
 *
 * This is fine for now (early-stage). Later, we optimize by storing user_id
 * alongside email in your own "profiles/users" table.
 */
export async function findSupabaseUserByEmail(email: string) {
  const target = cleanEmail(email);
  if (!target || !target.includes("@")) return null;

  const perPage = 1000;
  const maxPages = 20; // safety cap

  for (let page = 1; page <= maxPages; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) throw error;

    const users = data?.users || [];
    const found = users.find(
      (u: any) => cleanEmail(u?.email) === target
    );

    if (found) return found;

    // if fewer than perPage returned, no more pages
    if (users.length < perPage) break;
  }

  return null;
}

export async function confirmSupabaseEmailByEmail(email: string) {
  const user = await findSupabaseUserByEmail(email);

  if (!user) {
    return { ok: false as const, reason: "user_not_found" as const };
  }

  if (isConfirmed(user)) {
    return { ok: true as const, already: true as const, userId: user.id };
  }

  // This is the correct way to mark confirmed with Admin API
  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
    user.id,
    { email_confirm: true }
  );

  if (error) throw error;

  return {
    ok: true as const,
    already: false as const,
    userId: user.id,
    user: data?.user,
  };
}
