const SECRET_KEYS = new Set(["password", "pass", "secret", "token", "username", "rtsp_url", "edge_hls_url", "hls_url"]);

export function sanitizeCameraValue(value: any): any {
  if (Array.isArray(value)) return value.map(sanitizeCameraValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SECRET_KEYS.has(key.toLowerCase()))
    .map(([key, nested]) => [key, sanitizeCameraValue(nested)]));
}

export function sanitizeCameraRecord<T>(camera: T): T {
  return sanitizeCameraValue(camera) as T;
}
