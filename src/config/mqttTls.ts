// src/config/mqttTls.ts
//
// Security: MQTT TLS certificate-verification policy.
//
// Kept in its own module (separate from src/mqtt.ts) so that importers which
// only need the TLS options — e.g. src/device/bridge.ts — do not trigger the
// env-validating side effects that run when src/mqtt.ts is loaded (it creates
// a live MQTT client on import and throws if MQTT_HOST is missing).

/**
 * Resolve MQTT TLS certificate verification behavior.
 *
 * In production, certificate verification is ALWAYS enforced
 * (rejectUnauthorized=true) regardless of what MQTT_REJECT_UNAUTHORIZED is
 * set to. This prevents man-in-the-middle attacks on the device telemetry
 * path. The insecure flag is only honored when NODE_ENV is explicitly
 * "development" and the operator sets MQTT_REJECT_UNAUTHORIZED=false (e.g.
 * for local brokers using self-signed certs).
 */
export function resolveMqttTlsOptions() {
  const isProduction = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  const insecureFlag = String(process.env.MQTT_REJECT_UNAUTHORIZED || "").toLowerCase();
  const allowInsecure = !isProduction && insecureFlag === "false";

  if (isProduction && insecureFlag === "false") {
    // Surface the override-attempt so operators notice during deploy.
    // eslint-disable-next-line no-console
    console.warn("⚠️ MQTT_REJECT_UNAUTHORIZED=false ignored in production; TLS verification enforced.");
  }

  return {
    protocol: "mqtts" as const,
    rejectUnauthorized: !allowInsecure,
  };
}
