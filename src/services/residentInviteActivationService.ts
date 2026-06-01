import crypto from "crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { permissionsForRole } from "../core/foundation";

const APP_JWT_SECRET = process.env.APP_JWT_SECRET;

type InvitePreviewRow = {
  invite_id: string;
  estate_id: string;
  estate_name: string;
  home_id: string;
  home_label: string;
  invited_email: string | null;
  role: string;
  expires_at: string;
};

function hashInviteToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function maskEmail(email?: string | null) {
  const [local = "", domain = ""] = String(email || "").split("@");
  if (!local || !domain) return null;
  const prefix = local.slice(0, Math.min(2, local.length));
  return `${prefix}${"*".repeat(Math.max(1, local.length - prefix.length))}@${domain}`;
}

export function validateActivationPassword(password: string) {
  if (password.length < 10) return "Password must be at least 10 characters.";
  if (!/[a-z]/.test(password)) return "Password must include a lowercase letter.";
  if (!/[A-Z]/.test(password)) return "Password must include an uppercase letter.";
  if (!/[0-9]/.test(password)) return "Password must include a number.";
  return null;
}

function validateUsername(username: string) {
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) {
    return "Username must be 3-40 characters using letters, numbers, dots, dashes, or underscores.";
  }
  return null;
}

function signAppToken(user: any) {
  if (!APP_JWT_SECRET) throw new Error("APP_JWT_SECRET not set");
  const permissionScopes = Array.isArray(user.permission_scopes) ? user.permission_scopes : [];
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      estate_id: user.estate_id,
      home_id: user.home_id,
      permission_scopes: permissionScopes,
      permissions: permissionsForRole(user.role, permissionScopes),
    },
    APP_JWT_SECRET,
    { expiresIn: "30d" }
  );
}

async function loadInvitePreview(tokenHash: string): Promise<InvitePreviewRow> {
  const { data, error } = await supabaseAdmin.rpc("validate_resident_invite", {
    p_token_hash: tokenHash,
  });

  if (error) throw new Error(error.message);
  const preview = Array.isArray(data) ? data[0] : data;
  if (!preview?.invite_id) throw new Error("Invite not found");
  return preview as InvitePreviewRow;
}

export async function validateResidentInvite(token: string) {
  const clean = String(token || "").trim();
  if (!clean) throw new Error("Invite token is required");
  const preview = await loadInvitePreview(hashInviteToken(clean));
  return {
    invite_id: preview.invite_id,
    estate: { id: preview.estate_id, name: preview.estate_name },
    home: { id: preview.home_id, label: preview.home_label },
    invited_email: maskEmail(preview.invited_email),
    role: preview.role,
    expires_at: preview.expires_at,
  };
}

export async function activateResidentInvite(input: {
  token: string;
  username: string;
  password: string;
  confirmPassword: string;
}) {
  const token = String(input.token || "").trim();
  const username = String(input.username || "").trim();
  const password = String(input.password || "");
  if (!token) throw new Error("Invite token is required");
  if (password !== String(input.confirmPassword || "")) throw new Error("Passwords do not match");

  const usernameError = validateUsername(username);
  if (usernameError) throw new Error(usernameError);
  const passwordError = validateActivationPassword(password);
  if (passwordError) throw new Error(passwordError);

  const passwordHash = await bcrypt.hash(password, 10);
  const { data, error } = await supabaseAdmin.rpc("activate_resident_invite", {
    p_token_hash: hashInviteToken(token),
    p_username: username,
    p_password_hash: passwordHash,
  });

  if (error) throw new Error(error.message);
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.user_id) throw new Error("Invite activation failed");

  const { data: user, error: userError } = await supabaseAdmin
    .from("users")
    .select("id,email,username,full_name,phone,avatar_url,profile_image_url,role,estate_id,home_id,permission_scopes")
    .eq("id", result.user_id)
    .single();
  if (userError || !user) throw new Error(userError?.message || "Activated profile could not be loaded");

  return {
    ok: true,
    token: signAppToken(user),
    user,
    profile: user,
    estate: { id: result.estate_id, name: result.estate_name },
    home: { id: result.home_id, name: result.home_name, block: result.home_block, unit: result.home_unit },
    estate_id: result.estate_id,
    home_id: result.home_id,
    available_contexts: [{
      estate_id: result.estate_id,
      estate_name: result.estate_name,
      home_id: result.home_id,
      home_name: result.home_name,
      block: result.home_block,
      unit: result.home_unit,
      role: result.role,
      status: "active",
      is_active: true,
    }],
    onboarding_complete: true,
  };
}
