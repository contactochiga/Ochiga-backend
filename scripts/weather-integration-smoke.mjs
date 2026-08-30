#!/usr/bin/env node
// Live Weather + Environmental Context Integration. Static regression
// proof that the weather module is a real provider abstraction behind a
// canonical contract, server-side cached, tenant-scoped, fails safe, and
// never leaks the provider key -- not a client-side widget calling a
// third-party API directly.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const contracts = fs.readFileSync(path.join(root, "src/services/weather/weatherContracts.ts"), "utf8");
const provider = fs.readFileSync(path.join(root, "src/services/weather/OpenWeatherMapProvider.ts"), "utf8");
const service = fs.readFileSync(path.join(root, "src/services/weather/weatherService.ts"), "utf8");
const routes = fs.readFileSync(path.join(root, "src/routes/facility.routes.ts"), "utf8");
const envConfig = fs.readFileSync(path.join(root, "src/config/env.ts"), "utf8");

const failures = [];
function need(condition, message) {
  if (!condition) failures.push(message);
}

// 1. Provider abstraction -- the rest of the platform depends on an
// interface, not a concrete provider.
need(contracts.includes("export interface WeatherProvider"), "WeatherProvider interface must exist so providers are swappable");
need(provider.includes("export class OpenWeatherMapProvider implements WeatherProvider"), "OpenWeatherMapProvider must implement the WeatherProvider interface");
need(service.includes("const provider: WeatherProvider = openWeatherMapProvider"), "weatherService must depend on the WeatherProvider type, not the concrete class, at its call sites");

// 2. Canonical contract -- normalized, not raw provider JSON.
for (const field of ["temperature", "feels_like", "humidity", "precipitation", "precipitation_probability", "wind_speed", "wind_direction", "condition"]) {
  need(contracts.includes(`${field}:`), `CanonicalCurrentWeather is missing required field: ${field}`);
}
need(contracts.includes("export type WeatherMetadata"), "canonical response must carry freshness/provider metadata");
need(contracts.includes("stale: boolean"), "canonical metadata must expose a stale flag");

// 3. No client-side fetch, no key exposure -- this is all backend code
// (this smoke only reads backend files), and the key is read exclusively
// from process.env, never accepted from a request.
need(provider.includes('process.env.WEATHER_API_KEY'), "API key must come from server-side environment, not a request parameter");
need(!provider.includes("req.body") && !provider.includes("req.query"), "provider adapter must never read request input directly");
need(!routes.includes("WEATHER_API_KEY"), "the route layer must never reference the API key directly -- only weatherService/provider should");

// 4. Facility location authority -- server resolves it from the
// session's own estate_id, the caller never submits a Facility id.
need(routes.includes('router.get("/environment/weather", requireAuth, requirePermission("devices.read")'), "weather route must require auth + an existing Facility permission, not a new bespoke one");
need(routes.includes("const estateId = req.user?.estate_id"), "location must resolve from the authenticated session's own estate_id, never a client-submitted id");
need(service.includes('.from("estates")') && service.includes("select(\"lat, lng, timezone, address, name\")"), "location must resolve from the real estates.lat/lng/timezone/address columns");
need(service.includes('code: "location_required"'), "a Facility with no coordinates must get an honest location-required response, not fabricated weather");

// 5. Server-side caching -- keyed by Facility, TTL-based freshness,
// graceful stale-serving on provider failure, no request storm.
need(service.includes("redis.get(cacheKey") || service.includes("readCache"), "cache reads must exist");
need(service.includes("redis.set(cacheKey") || service.includes("writeCache"), "cache writes must exist");
need(service.includes("cacheKey(estateId: string)") && service.includes("`weather:facility:${estateId}`"), "cache must be keyed per Facility, not global");
need(service.includes("CURRENT_FRESH_TTL_MS"), "a freshness TTL must gate whether the provider is called again");
need(service.includes("stale: true"), "provider failure with existing cache must return stale:true, never silently pretend the data is fresh");
need(service.includes('code: "provider_unavailable"'), "provider failure with no cache must return a truthful unavailable state, never a fabricated zero/default reading");

// 6. Intelligence integration -- reuses the existing canonical event
// publisher, does not invent a parallel intelligence architecture.
need(service.includes("publishSourceIntelligenceEvent"), "a fresh weather observation must be recorded through the existing canonical intelligence-event publisher");
need(service.includes('event_type: "weather.condition.observed"'), "weather signal must use the established dotted event-type taxonomy");
need(service.includes("void recordWeatherSignal(estateId, result.current, location)") && !service.includes("recordWeatherSignal(estateId, cached"), "the intelligence event must fire only on a genuinely fresh provider fetch, never on a cache hit -- avoids signal spam");
need(service.includes("severityFor(") && service.includes('"critical"') && service.includes('"warning"'), "severity must be computed from real observed values against disclosed thresholds, not hardcoded");

// 7. Environment variable convention matches the rest of the codebase.
need(envConfig.includes('name: "WEATHER_API_KEY"') && envConfig.includes("required: false"), "WEATHER_API_KEY must be registered as an optional env rule, consistent with every other optional provider integration");

if (failures.length) {
  console.error("Weather integration smoke failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("Weather integration smoke passed.");
