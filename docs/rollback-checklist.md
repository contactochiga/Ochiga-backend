# Rollback Checklist

- Roll back the backend deploy artifact first.
- Keep database schema backward compatibility for at least one release window.
- Disable provider ingress paths temporarily if runtime behavior is uncertain after rollback.
- Re-verify `/health` and `/health/runtime`.
- Confirm queue workers reconnect cleanly after rollback.
- Review audit logs for failed auth, permission denials, and provider failures during the incident window.
