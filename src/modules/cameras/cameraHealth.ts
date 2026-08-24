export function canonicalCameraHealth(camera: any) {
  const metadata = camera?.metadata && typeof camera.metadata === "object" ? camera.metadata : {};
  const streamStatus = camera?.stream_status || metadata.stream_status || camera?.health_status || camera?.status || "pending";
  return {
    online: ["online", "active", "healthy", "ok"].includes(String(streamStatus).toLowerCase()),
    status: camera?.health_status || camera?.status || "pending",
    stream_status: streamStatus,
    last_seen_at: camera?.last_seen_at || null,
    last_health_at: camera?.last_health_check_at || metadata.last_health_at || null,
    last_success_at: camera?.last_success_at || metadata.last_success_at || null,
    last_failure_at: camera?.last_failure_at || metadata.last_failure_at || null,
    latency_ms: camera?.latency_ms ?? metadata.latency_ms ?? null,
    reconnect_count: camera?.reconnect_count ?? metadata.reconnect_count ?? 0,
    provider_error: camera?.provider_error || camera?.error_message || metadata.provider_error || null,
    frame_freshness_at: metadata.frame_freshness_at || metadata.last_frame_at || null,
  };
}

export function withCanonicalCameraHealth(camera: any) {
  return { ...camera, health: canonicalCameraHealth(camera) };
}
