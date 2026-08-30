// Live Weather + Environmental Context Integration.
//
// Selected provider: OpenWeatherMap (One Call API 3.0). Chosen because it
// gives current conditions + hourly + daily forecast in a single request
// (minimizing calls against the cache TTL budget below), has clear
// commercial pricing tiers with a documented free allowance (1,000
// calls/day), returns precipitation probability (`pop`), humidity, wind
// speed/direction, UV index and pressure natively, and uses a
// straightforward REST/JSON contract with no SDK dependency required.
//
// This file is the ONLY place that knows OpenWeatherMap's response
// shape. Everything downstream (weatherService, Environment, Oyi
// intelligence) only ever sees the canonical types in
// weatherContracts.ts -- swapping providers later means writing a new
// class here, not touching any consumer.
import axios from "axios";
import type { CanonicalCurrentWeather, CanonicalForecastEntry, WeatherCondition, WeatherLocation, WeatherProvider } from "./weatherContracts";

const BASE_URL = "https://api.openweathermap.org/data/3.0/onecall";
const REQUEST_TIMEOUT_MS = 8000;

// OpenWeatherMap's `weather[0].id` code ranges, mapped onto Oyi's small
// canonical condition set. https://openweathermap.org/weather-conditions
function conditionFromCode(code: number): WeatherCondition {
  if (code >= 200 && code < 300) return "thunderstorm";
  if (code >= 300 && code < 400) return "drizzle";
  if (code === 500 || code === 501) return "rain";
  if (code >= 502 && code < 600) return "heavy_rain";
  if (code >= 600 && code < 700) return code >= 611 && code <= 613 ? "sleet" : "snow";
  if (code >= 700 && code < 800) return "fog";
  if (code === 800) return "clear";
  if (code === 801 || code === 802) return "partly_cloudy";
  if (code >= 803 && code < 900) return "cloudy";
  return "unknown";
}

function normalizeWeatherEntry(entry: any): { condition_code: string; condition: WeatherCondition; condition_label: string } {
  const first = Array.isArray(entry) ? entry[0] : entry;
  const code = Number(first?.id) || 0;
  return {
    condition_code: String(code || "unknown"),
    condition: conditionFromCode(code),
    condition_label: String(first?.description || first?.main || "Unknown").replace(/\b\w/g, (c: string) => c.toUpperCase()),
  };
}

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function precipitationFrom(entry: any): number | null {
  const rain = num(entry?.rain?.["1h"]);
  const snow = num(entry?.snow?.["1h"]);
  if (rain !== null && snow !== null) return rain + snow;
  return rain ?? snow ?? null;
}

// OpenWeatherMap returns wind_speed in metres/second even with
// units=metric (metric only affects temperature/pressure). Converted to
// km/h here -- once, in the one file that knows about this provider
// quirk -- so the canonical contract's wind_speed is unambiguously km/h
// everywhere else in the platform.
function windKmh(value: unknown): number | null {
  const metersPerSecond = num(value);
  return metersPerSecond === null ? null : Math.round(metersPerSecond * 3.6 * 10) / 10;
}

export class OpenWeatherMapProvider implements WeatherProvider {
  readonly name = "openweathermap";

  isConfigured(): boolean {
    return Boolean(String(process.env.WEATHER_API_KEY || "").trim());
  }

  async getCurrentAndForecast(location: WeatherLocation): Promise<{ current: CanonicalCurrentWeather; forecast: CanonicalForecastEntry[] } | null> {
    const apiKey = String(process.env.WEATHER_API_KEY || "").trim();
    if (!apiKey) return null;

    const response = await axios.get(BASE_URL, {
      timeout: REQUEST_TIMEOUT_MS,
      params: {
        lat: location.lat,
        lon: location.lng,
        appid: apiKey,
        units: "metric",
        exclude: "minutely,alerts",
      },
    });

    const payload = response.data || {};
    const currentRaw = payload.current || {};
    const currentCondition = normalizeWeatherEntry(currentRaw.weather);

    const current: CanonicalCurrentWeather = {
      observed_at: currentRaw.dt ? new Date(currentRaw.dt * 1000).toISOString() : new Date().toISOString(),
      condition: currentCondition.condition,
      condition_code: currentCondition.condition_code,
      condition_label: currentCondition.condition_label,
      temperature: num(currentRaw.temp) ?? 0,
      feels_like: num(currentRaw.feels_like),
      humidity: num(currentRaw.humidity),
      precipitation: precipitationFrom(currentRaw),
      // OpenWeatherMap's `current` block has no `pop` -- only hourly/daily
      // entries do. The nearest hourly entry (index 0, "this hour") is the
      // most honest proxy for "current precipitation probability" rather
      // than inventing one.
      precipitation_probability: num(payload.hourly?.[0]?.pop) !== null ? Math.round((num(payload.hourly?.[0]?.pop) as number) * 100) : null,
      wind_speed: windKmh(currentRaw.wind_speed),
      wind_direction: num(currentRaw.wind_deg),
      pressure: num(currentRaw.pressure),
      visibility: num(currentRaw.visibility),
      cloud_cover: num(currentRaw.clouds),
      uv_index: num(currentRaw.uvi),
    };

    // Near-term forecast: next 24 hours of hourly data -- operationally
    // useful (per spec preference for "next several hours / today" over a
    // giant consumer 7-day forecast), and hourly already carries `pop`
    // (precipitation probability) natively, unlike the current block.
    const hourly = Array.isArray(payload.hourly) ? payload.hourly.slice(0, 24) : [];
    const forecast: CanonicalForecastEntry[] = hourly.map((entry: any) => {
      const cond = normalizeWeatherEntry(entry.weather);
      return {
        timestamp: entry.dt ? new Date(entry.dt * 1000).toISOString() : new Date().toISOString(),
        temperature: num(entry.temp),
        temperature_min: null,
        temperature_max: null,
        condition: cond.condition,
        condition_code: cond.condition_code,
        condition_label: cond.condition_label,
        precipitation_probability: num(entry.pop) !== null ? Math.round((num(entry.pop) as number) * 100) : null,
        precipitation_amount: precipitationFrom(entry),
        humidity: num(entry.humidity),
        wind_speed: windKmh(entry.wind_speed),
        uv_index: num(entry.uvi),
      };
    });

    return { current, forecast };
  }
}

export const openWeatherMapProvider = new OpenWeatherMapProvider();
