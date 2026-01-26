// src/services/userVerificationService.ts
import { supabaseAdmin } from "../supabase/supabaseClient";

export async function markSupabaseEmailVerified(email: string) {
  const cleanEmail = email.trim().toLowerCase();

  // 1) Find user by email
  const { data, error } = await supabaseAdmin.auth.admin.getUserByEmail(cleanEmail);

  if (error) throw new Error(`Supabase getUserByEmail failed: ${error.message}`);
  if (!data?.user) throw new Error("Supabase user not found for this email");

  // 2) Mark email as confirmed
  const { data: updated, error: updateError } =
    await supabaseAdmin.auth.admin.updateUserById(data.user.id, {
      email_confirm: true,
    });

  if (updateError) throw new Error(`Supabase updateUserById failed: ${updateError.message}`);

  return {
    userId: data.user.id,
    email: updated?.user?.email || cleanEmail,
    email_confirmed_at: updated?.user?.email_confirmed_at || null,
  };
}
