# Environment Variable Checklist

## Required Base Variables

- `APP_JWT_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `REDIS_URL`

## Feature-Conditional Variables

- Mail:
  - `MAIL_ENABLED=true` requires `RESEND_API_KEY`
- Tuya:
  - `TUYA_ENABLED=true` requires `TUYA_ACCESS_ID`, `TUYA_ACCESS_SECRET`, `TUYA_BASE_URL`
- MQTT:
  - `MQTT_ENABLED=true` requires `MQTT_URL`
  - if broker auth is enabled, also provide `MQTT_USERNAME` and `MQTT_PASSWORD`
- Weather (Facility Environment live weather):
  - `WEATHER_API_KEY` -- OpenWeatherMap One Call API 3.0 key. Optional: absent means Facility Environment reports weather as unavailable rather than failing.

## Optional Push Variables

- `FCM_SERVER_KEY`
- `APNS_KEY_ID`
- `APNS_TEAM_ID`
- `APNS_BUNDLE_ID`
- `APNS_PRIVATE_KEY` or `APNS_PRIVATE_KEY_BASE64`
