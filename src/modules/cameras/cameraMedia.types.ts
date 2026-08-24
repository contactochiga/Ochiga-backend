export const CAMERA_MEDIA_KINDS = ["snapshot","event_snapshot","thumbnail","clip","recording_segment","recording"] as const;
export type CameraMediaKind = typeof CAMERA_MEDIA_KINDS[number];
export type CameraMediaRetention = "ephemeral"|"standard"|"security"|"evidence";
export const CAMERA_MEDIA_ERRORS = ["snapshot_unavailable","media_capture_failed","media_upload_failed","media_not_found","media_access_denied","media_expired","unsupported_media_kind","storage_unavailable","retention_locked","clip_unavailable","recording_unavailable"] as const;
export const SNAPSHOT_MAX_BYTES = 5 * 1024 * 1024;
export const CLIP_MAX_BYTES = 50 * 1024 * 1024;
export const MEDIA_ACCESS_TTL_SECONDS = 90;

export function verifyMediaContent(bytes: Buffer, mime: string, kind: CameraMediaKind) {
  const image = kind === "snapshot" || kind === "event_snapshot" || kind === "thumbnail";
  const max = image ? SNAPSHOT_MAX_BYTES : CLIP_MAX_BYTES;
  if (!bytes.length || bytes.length > max) return { ok:false as const, code:"media_upload_failed", reason:"invalid_size" };
  const jpeg = bytes.length > 3 && bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff;
  const webp = bytes.length > 12 && bytes.subarray(0,4).toString("ascii")==="RIFF" && bytes.subarray(8,12).toString("ascii")==="WEBP";
  const mp4 = bytes.length > 12 && bytes.subarray(4,8).toString("ascii")==="ftyp";
  const valid = (mime==="image/jpeg"&&jpeg)||(mime==="image/webp"&&webp)||(mime==="video/mp4"&&mp4);
  if (!valid || (image && !mime.startsWith("image/")) || (!image && !mime.startsWith("video/"))) return { ok:false as const, code:"media_upload_failed", reason:"invalid_mime" };
  return { ok:true as const, maxBytes:max };
}
