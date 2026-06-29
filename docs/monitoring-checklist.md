# Monitoring Checklist

- Structured logs must be collected centrally.
- Alert on `/health` non-200 responses.
- Alert on provider states `offline` or `degraded`.
- Alert on repeated `oyi_provider_failures_total` increases.
- Track runtime stage latency metrics for regression.
- Track queue and websocket health after every deploy.
- Review `audit_events` for auth failures, permission denials, and abnormal administrative actions.
