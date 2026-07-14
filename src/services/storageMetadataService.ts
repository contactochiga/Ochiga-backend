import { randomBytes } from "crypto";
import { supabaseAdmin } from "../supabase/supabaseClient";

export const PLATFORM_FILE_PURPOSES = [
  "staff_photo",
  "resident_photo",
  "estate_image",
  "document",
  "generated_pdf",
  "plan_upload",
  "camera_snapshot",
  "device_snapshot",
  "digital_twin_file",
] as const;

export type PlatformFilePurpose = (typeof PLATFORM_FILE_PURPOSES)[number];

export type PlatformFileInput = {
  fileId?: string;
  ownerType: string;
  ownerId?: string | null;
  estateId?: string | null;
  homeId?: string | null;
  purpose: PlatformFilePurpose | string;
  filename: string;
  mimeType?: string | null;
  size?: number | null;
  storageDriver?: string | null;
  storagePath?: string | null;
  publicUrl?: string | null;
  createdBy?: string | null;
  metadata?: Record<string, any>;
};

export async function recordPlatformFile(input: PlatformFileInput) {
  const row = {
    file_id: input.fileId || `${Date.now()}_${randomBytes(5).toString("hex")}`,
    owner_type: input.ownerType,
    owner_id: input.ownerId || null,
    estate_id: input.estateId || null,
    home_id: input.homeId || null,
    purpose: input.purpose,
    filename: input.filename,
    mime_type: input.mimeType || "application/octet-stream",
    size: Number(input.size || 0),
    storage_driver: input.storageDriver || "unknown",
    storage_path: input.storagePath || "",
    public_url: input.publicUrl || "",
    created_by: input.createdBy || null,
    metadata: input.metadata || {},
  };

  const { data, error } = await supabaseAdmin.from("platform_files").insert(row as any).select("*").single();
  if (error) {
    console.warn("[storage-metadata] write failed:", error.message);
    return { ...row, write_failed: true, error: error.message };
  }
  return data;
}
