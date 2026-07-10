# Backend v1 Completion Audit

## Classification Summary

### Canonical
- `src/core/*`, `src/oyi-core/*`, `src/realtime/*`: normalized runtime, awareness, recommendations, automation, execution ledger, continuity correlation.
- `src/controllers/device*.ts`, `src/device/*`, `src/services/device*`: canonical device registry, runtime, command, IR child support, health and activity enrichment.
- `src/controllers/walletController.ts`, `src/routes/wallets.ts`: canonical wallet funding, verification, receipt, notification, and return-status surface.
- `src/services/NotificationService.ts`, notification routing migrations and smokes: canonical notification evaluation and delivery path.
- `src/controllers/servicesController.ts`: canonical infrastructure services runtime.

### Compatibility Wrapper
- Legacy `/wallets/verify/:reference` remains as a fallback wrapper around the canonical funding reconciliation flow.
- Legacy `/oyi`, `/ai`, and `/intelligence` route aliases should continue calling canonical Oyi Core services until client migration is complete.

### Duplicate / Deprecated
- Device-list-triggered IR sync inside `GET /devices/estate/:estateId` was a duplicate write path and production risk. Removed from listing and retained only through explicit/provider-driven sync flows.
- Older direct error propagation patterns across controllers remain transitional and should keep moving to `publicApi` sanitization without introducing new error shapes.

### Needs Migration
- Production schema drift around device identity and IR child columns must continue to be guarded by release checks.
- Any environment still relying only on `devices_vendor_external_id_uniq` should be treated as compatibility state while code now supports both legacy and canonical conflict targets.

### Production Risks Addressed In This Pass
- IR virtual child identity collisions with parent hubs.
- Inline registry writes during device listing.
- Raw SQL/provider errors reaching clients.
- Thin wallet return flow without canonical status/receipt confirmation.
- Split CORS / Socket.IO origin policy.

## Freeze Boundary

No new foundational backend engines should be added after this pass.

Allowed post-freeze work:
- provider adapters
- integration adapters
- security hardening
- observability
- performance
- bug fixes
- intelligence calibration
- Digital Twin bindings

Disallowed post-freeze work:
- parallel runtime engines
- duplicate wallet ledgers
- parallel notification paths
- provider-specific resident UI contracts
- duplicate intelligence services
