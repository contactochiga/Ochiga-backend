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
  const health = canonicalCameraHealth(camera);
  const mediaConfigured = Boolean(camera?.edge_hls_url || camera?.hls_url);
  const mediaAvailability = mediaConfigured ? (health.online ? "available" : "configured") : "unavailable";
  const metadata = camera?.metadata && typeof camera.metadata === "object" ? camera.metadata : {};
  const configuredDetection = (key: string) => ({ availability: camera?.ai_enabled && metadata[key] === true ? "configured" : "unknown", source: "camera_profile" });
  return {
    ...camera,
    health,
    capabilities: {
      liveView: { availability: mediaAvailability, source: "edge_hls" },
      playback: { availability: mediaAvailability, source: "edge_hls" },
      snapshots: { availability: "unknown" }, audio: { availability: "unknown" }, ptz: { availability: "unknown" },
      motionDetection: configuredDetection("detect_motion"), personDetection: configuredDetection("detect_person"),
      vehicleDetection: configuredDetection("detect_vehicle"), lineCrossing: configuredDetection("detect_line_crossing"),
      zoneIntrusion: configuredDetection("detect_zone_intrusion"), faceDetection: configuredDetection("detect_face"),
      faceRecognition: { availability: "unavailable", source: "runtime" }, anpr: { availability: "unavailable", source: "runtime" },
      recording: { availability: "unavailable", source: "runtime" },
    },
  };
}
