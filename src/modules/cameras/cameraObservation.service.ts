import { supabaseAdmin } from "../../supabase/supabaseClient";

/** Observation ingestion only. No health classifier, media URL, or signal output. */
export async function ingestCameraObservations(identity: {id:string;siteId:string;legacy?:boolean}, observations: unknown) {
  if (!identity?.id || !identity.siteId || identity.legacy) throw new Error("camera_observation_identity_required");
  if (!Array.isArray(observations) || observations.length < 1 || observations.length > 128 || Buffer.byteLength(JSON.stringify(observations)) > 524288) {
    throw new Error("camera_observation_batch_invalid");
  }
  // SQL repeats validation and assignment checks while holding camera locks.
  if (observations.some(item => !item || item.edge_node_id !== identity.id)) throw new Error("camera_assignment_denied");
  const {data,error} = await supabaseAdmin.rpc("oyi_ingest_camera_observations", {
    p_estate_id: identity.siteId, p_edge_node_id: identity.id, p_observations: observations,
  });
  if (error) throw error;
  return data;
}

/** Media is its own durable evidence. Retry this even when media already exists.
 * Require the original supplied capture timestamp; never invent one from receipt.
 * No thumbnail/clip/recording implies live image acquisition. */
export async function repairMediaFrameObservation(media: any, suppliedCapturedAt?: string) {
  if (!["snapshot","event_snapshot"].includes(media.kind)) return;
  if (!suppliedCapturedAt || !/(Z|[+-]\d{2}:\d{2})$/.test(suppliedCapturedAt) ||
      !Number.isFinite(Date.parse(suppliedCapturedAt)) || Date.parse(suppliedCapturedAt) !== Date.parse(media.captured_at)) return;
  await ingestCameraObservations({id:media.edge_node_id,siteId:media.estate_id}, [{
    schema_version:1, observation_id:media.id, camera_id:media.camera_id, edge_node_id:media.edge_node_id,
    kind:"frame",source:"media_ingestion",observed_at:new Date(media.captured_at).toISOString(),result:"acquired",
    details:{mime_type:media.mime_type,size_bytes:media.size_bytes,validation:"bounded_image_signature",media_id:media.id},
  }]);
}
