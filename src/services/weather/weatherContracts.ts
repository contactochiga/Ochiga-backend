// Live Weather + Environmental Context Integration.
//
// This is the canonical Oyi weather contract. The rest of the platform
// (Environment, Oyi intelligence, and later Automation) consumes ONLY
// these shapes -- never a provider's raw JSON. Swapping the provider
// later (OpenWeatherMap -> Open-Meteo -> anything else) means writing a
// new class that implements WeatherProvider; nothing else changes.

export type WeatherLocation = {
  lat: number;
  lng: number;
  timezone?: string | null;
  locality?: string | null;
};

export type WeatherCondition =
  | "clear"
  | "partly_cloudy"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "heavy_rain"
  | "thunderstorm"
  | "snow"
  | "sleet"
  | "windy"
  | "unknown";

// Units are fixed and normalized regardless of provider: temperature in
// °C, humidity/cloud_cover/precipitation_probability in %, precipitation
// in mm, wind_speed in km/h, wind_direction in degrees, pressure in hPa,
// visibility in metres, uv_index unitless (0-11+ scale).
export type CanonicalCurrentWeather = {
  observed_at: string;
  condition: WeatherCondition;
  condition_code: string;
  condition_label: string;
  temperature: number;
  feels_like: number | null;
  humidity: number | null;
  precipitation: number | null;
  precipitation_probability: number | null;
  wind_speed: number | null;
  wind_direction: number | null;
  pressure: number | null;
  visibility: number | null;
  cloud_cover: number | null;
  uv_index: number | null;
};

export type CanonicalForecastEntry = {
  timestamp: string;
  temperature: number | null;
  temperature_min: number | null;
  temperature_max: number | null;
  condition: WeatherCondition;
  condition_code: string;
  condition_label: string;
  precipitation_probability: number | null;
  precipitation_amount: number | null;
  humidity: number | null;
  wind_speed: number | null;
  uv_index: number | null;
};

export type WeatherMetadata = {
  provider: string;
  fetched_at: string;
  age_seconds: number;
  stale: boolean;
  source_status: "live" | "cached" | "stale_cache" | "unavailable";
};

export type CanonicalWeatherResponse = {
  available: true;
  location: WeatherLocation;
  current: CanonicalCurrentWeather;
  forecast: CanonicalForecastEntry[];
  metadata: WeatherMetadata;
} | {
  available: false;
  code: "location_required" | "provider_unavailable" | "provider_not_configured";
  message: string;
};

export interface WeatherProvider {
  readonly name: string;
  isConfigured(): boolean;
  getCurrentAndForecast(location: WeatherLocation): Promise<{ current: CanonicalCurrentWeather; forecast: CanonicalForecastEntry[] } | null>;
}
