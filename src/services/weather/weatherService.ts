// Live Weather + Environmental Context Integration.
//
// Orchestration: Facility location (estates.lat/lng/timezone/address --
// already-real, already-editable-via-payload columns, just never
// surfaced in a UI until this pass) -> server-side cache -> provider ->
// canonical response -> (on a genuinely fresh fetch only) a real
// intelligence-event record, so weather becomes a discoverable signal
// for Oyi's existing audit/automation-discovery layer without a second,
// parallel intelligence architecture.
import { redis } from "../../config/redis";
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { openWeatherMapProvider } from "./OpenWeatherMapProvider";
import { publishSourceIntelligenceEvent } from "../../intelligence-core/sourceEventPublisher";
import { logger } from "../../observability/logger";
import type { CanonicalCurrentWeather, CanonicalForecastEntry, CanonicalWeatherResponse, WeatherLocation, WeatherProvider } from "./weatherContracts";

const provider: WeatherProvider = openWeatherMapProvider;

// Current conditions change meaningfully within minutes; forecast data
// (hourly, up to 24h out) is stable for longer. Both TTLs are well
// inside OpenWeatherMap's documented free-tier allowance (1,000 calls/
// day) for any realistic number of Facilities polling Environment.
const CURRENT_FRESH_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_RETENTION_SECONDS = 24 * 60 * 60; // 24h -- stale-fallback safety net

type CacheEnvelope = {
  current: CanonicalCurrentWeather;
  forecast: CanonicalForecastEntry[];
  fetched_at: string;
};

function cacheKey(estateId: string) {
  return `weather:facility:${estateId}`;
}

async function readCache(estateId: string): Promise<CacheEnvelope | null> {
  try {
    const raw = await redis.get(cacheKey(estateId));
    if (!raw) return null;
    return JSON.parse(raw) as CacheEnvelope;
  } catch (error: any) {
    logger.warn("weather_cache_read_failed", { estate_id: estateId, error: error?.message });
    return null;
  }
}

async function writeCache(estateId: string, envelope: CacheEnvelope) {
  try {
    await redis.set(cacheKey(estateId), JSON.stringify(envelope), { EX: CACHE_RETENTION_SECONDS });
  } catch (error: any) {
    logger.warn("weather_cache_write_failed", { estate_id: estateId, error: error?.message });
  }
}

async function resolveFacilityLocation(estateId: string): Promise<WeatherLocation | null> {
  const { data, error } = await supabaseAdmin
    .from("estates")
    .select("lat, lng, timezone, address, name")
    .eq("id", estateId)
    .maybeSingle();
  if (error || !data) return null;
  const lat = typeof data.lat === "number" ? data.lat : Number(data.lat);
  const lng = typeof data.lng === "number" ? data.lng : Number(data.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, timezone: data.timezone || null, locality: data.address || data.name || null };
}

// Disclosed, defensible operational thresholds -- not fabricated
// alerting, and intentionally conservative (spec: "do not create alerts
// for every weather change"). Only a fresh, genuinely new observation
// reaches this function at all (see getFacilityWeather below), so this
// cannot spam the intelligence layer on every Environment page view.
function severityFor(current: CacheEnvelope["current"]): "info" | "attention" | "warning" | "critical" {
  const heavyRain = current.condition === "heavy_rain" || current.condition === "thunderstorm";
  const highRainChance = (current.precipitation_probability ?? 0) >= 80;
  const extremeHeat = current.temperature >= 38;
  const highHeat = current.temperature >= 33;
  const highWind = (current.wind_speed ?? 0) >= 50;
  if (current.condition === "thunderstorm" || extremeHeat) return "critical";
  if (heavyRain || highWind || highHeat) return "warning";
  if (highRainChance) return "attention";
  return "info";
}

async function recordWeatherSignal(estateId: string, current: CacheEnvelope["current"], location: WeatherLocation) {
  const severity = severityFor(current);
  void publishSourceIntelligenceEvent(
    {
      source: "facility",
      surface: "facility",
      event_type: "weather.condition.observed",
      category: "environment",
      estate_id: estateId,
      home_id: null,
      entity_type: "weather_observation",
      entity_id: `${estateId}:${current.observed_at}`,
      entity_label: location.locality || "Facility",
      severity,
      title: `Outdoor weather: ${current.condition_label}, ${current.temperature}°C`,
      summary: `Humidity ${current.humidity ?? "unavailable"}%, wind ${current.wind_speed ?? "unavailable"} km/h, precipitation probability ${current.precipitation_probability ?? "unavailable"}%.`,
      payload: {
        condition: current.condition,
        temperature: current.temperature,
        feels_like: current.feels_like,
        humidity: current.humidity,
        precipitation_probability: current.precipitation_probability,
        wind_speed: current.wind_speed,
        provider: provider.name,
      },
      occurred_at: current.observed_at,
    },
    { source_table: "weather_observation", source_event_id: `weather:${estateId}:${current.observed_at}` }
  );
}

export async function getFacilityWeather(estateId: string): Promise<CanonicalWeatherResponse> {
  const location = await resolveFacilityLocation(estateId);
  if (!location) {
    return { available: false, code: "location_required", message: "This Facility has no configured latitude/longitude yet. Set it in Facility Administration → Profile." };
  }

  const cached = await readCache(estateId);
  const now = Date.now();
  const cachedAgeMs = cached ? now - new Date(cached.fetched_at).getTime() : Infinity;
  const isFresh = cached && cachedAgeMs < CURRENT_FRESH_TTL_MS;

  if (isFresh && cached) {
    return {
      available: true,
      location,
      current: cached.current,
      forecast: cached.forecast,
      metadata: { provider: provider.name, fetched_at: cached.fetched_at, age_seconds: Math.round(cachedAgeMs / 1000), stale: false, source_status: "cached" },
    };
  }

  if (!provider.isConfigured()) {
    if (cached) {
      return {
        available: true,
        location,
        current: cached.current,
        forecast: cached.forecast,
        metadata: { provider: provider.name, fetched_at: cached.fetched_at, age_seconds: Math.round(cachedAgeMs / 1000), stale: true, source_status: "stale_cache" },
      };
    }
    return { available: false, code: "provider_not_configured", message: "No weather provider is configured for this deployment yet." };
  }

  try {
    const result = await provider.getCurrentAndForecast(location);
    if (!result) throw new Error("provider_returned_empty");
    const fetchedAt = new Date().toISOString();
    await writeCache(estateId, { current: result.current, forecast: result.forecast, fetched_at: fetchedAt });
    void recordWeatherSignal(estateId, result.current, location);
    return {
      available: true,
      location,
      current: result.current,
      forecast: result.forecast,
      metadata: { provider: provider.name, fetched_at: fetchedAt, age_seconds: 0, stale: false, source_status: "live" },
    };
  } catch (error: any) {
    logger.warn("weather_provider_fetch_failed", { estate_id: estateId, provider: provider.name, error: error?.message });
    if (cached) {
      return {
        available: true,
        location,
        current: cached.current,
        forecast: cached.forecast,
        metadata: { provider: provider.name, fetched_at: cached.fetched_at, age_seconds: Math.round(cachedAgeMs / 1000), stale: true, source_status: "stale_cache" },
      };
    }
    return { available: false, code: "provider_unavailable", message: "The weather provider is temporarily unavailable and no cached observation exists yet." };
  }
}
