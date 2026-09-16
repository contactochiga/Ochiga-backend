# src/core/control-plane — Architecture Decision (Wave 0)

**Status:** Decision document only. No code in `src/core/control-plane/` was changed or migrated by this slice. This document exists to unblock later waves (specifically Wave 5, "Action/control bypass migration," and any wave that would retire `intelligence-core`'s execution rail) by giving each piece of `control-plane` an explicit, evidence-based classification.

## The question

> What is the long-term role of `src/core/control-plane` once Oyi Core is canonical?

The preferred boundary, per the Oyi Intelligence Convergence programme:

```
Domain producer
      ↓
canonical signal ingress
      ↓
Oyi Core
      ↓
awareness/reasoning
      ↓
capability + authority
      ↓
Workflow / OyiAction
      ↓
domain adapter
      ↓
execution
```

`control-plane` was read in full for this decision (`index.ts`, `decisionEngine.ts`, `contracts/*`, `policies/*`, `subscribers/*`, `capabilities/deviceCapabilities.ts`). It does not play one role — it is three different things sharing a directory, each requiring a different disposition.

## Component-by-component classification

| Component | What it actually does | Classification | Why |
|---|---|---|---|
| `contracts/signal.types.ts`, `versions.ts`, `device.signal.types.ts`, `wallet.signal.types.ts`, `community.signal.types.ts` | Defines `Signal` (a narrow, closed union of ~7 signal shapes) and `SIGNAL_SCHEMA_VERSION` | **KEEP AS INFRASTRUCTURE** (with a caveat) | This is genuine, useful type infrastructure — every signal ingress site benefits from a versioned schema. The caveat: it is a **closed union**, and `oyiCoreRuntime.receiveSignal()` (the real canonical intelligence entry point) accepts a much broader `Partial<NormalizedSignal> & Record<string, unknown>` shape that is not constrained by this union at all. The two type systems are not unified. Keep this contract, but do not treat it as "the" canonical signal shape — `oyi-core/contracts/operationalSignal.ts`'s `NormalizedSignal` already plays that role and is the one this and later waves should converge toward. |
| `index.ts::handleSignal()` | Calls `oyiCoreRuntime.receiveSignal()` first, then unconditionally runs `notificationSubscriber`, `realtimeSubscriber`, and `evaluateSignal()` → `enqueueIntent()` | **MIGRATE INTO OYI CORE (ingress router only)** | The first line (`receiveSignal()`) is correctly canonical and should remain the pattern every signal producer follows. The rest of the function is where control-plane stops being ingress infrastructure and starts being a second, independent decision/execution/notification system (see below). A future wave should shrink `handleSignal()` to just the `receiveSignal()` call, or delete it in favor of direct calls to `oyi-core/ingress/canonicalSignalIngress.ts` (introduced this slice), once every current `handleSignal()` caller is confirmed to still need its other side effects or has been migrated off them. |
| `decisionEngine.ts` + `policies/visitor.policy.ts`, `devicePermission.policy.ts`, `deviceCapability.policy.ts`, `deviceCommand.policy.ts` | A second, independent policy → `Intent[]` → `enqueueIntent()` pipeline. `devicePermissionPolicy`/`deviceCapabilityPolicy` re-implement authority/capability checks (role/scope, allowed command types) that duplicate `CapabilityService.canUse()`'s job. `deviceCommandPolicy` produces a `device` intent that duplicates `ActionService`'s job. `visitorPolicy` produces a `notification` intent that duplicates Core's awareness → recommendation → notification path. | **MIGRATE INTO OYI CORE** | This is genuinely duplicated intelligence/authority/execution logic, exactly the pattern the convergence programme exists to eliminate. It is also a real, confirmed **duplicate-processing risk**: every signal that reaches `handleSignal()` is evaluated by this pipeline in addition to Core's own reasoning, and `deviceCommandPolicy`'s resulting intent is a second, capability-blind path toward device execution. Migration target: fold `devicePermissionPolicy`/`deviceCapabilityPolicy`'s checks into `CapabilityService`, and `deviceCommandPolicy`'s intent into `ActionService`/a domain adapter — this is the same shape of work as Wave 4/5's action-bypass migration and should be sequenced alongside it. |
| `policies/energy.policy.ts`, `policies/security.policy.ts` | Both are literal stubs: `(_: Signal): Intent[] { return []; }` | **RETIRE AFTER CUTOVER** (trivially — nothing to migrate) | Not dormant in the sense of "unreachable" — they are registered and run on every signal — but they contain no logic at all. Safe to delete outright once their siblings above are migrated and `decisionEngine.ts` is retired; keeping them a little longer costs nothing but they represent zero real capability today. |
| `workers/intentWorker.ts` (referenced by `handleSignal()`, not itself read line-by-line in this slice — flagged for a later wave's direct audit) | Consumes `Intent`s enqueued by `decisionEngine.ts` and (per the Phase 1 audit) executes them | **MIGRATE INTO OYI CORE** | Once `decisionEngine.ts`'s policies are migrated to produce `OyiAction`s via `ActionService` instead of `Intent`s via `enqueueIntent()`, this worker has nothing left to consume and can retire. Do not retire before that migration lands — it may still be the only execution path for some in-flight intents. |
| `subscribers/notificationSubscriber.ts` | A `switch (signal.type)` that calls `NotificationService` directly for `community.post.created`, `community.comment.created`, `wallet.funded`, `wallet.debited`; explicit `default: return;` for everything else | **COMPATIBILITY UNTIL CUTOVER** | Real, production-active, and — importantly — **safe by construction for new/unrecognized signal types**: the exhaustive switch with an explicit no-op default means this slice's two new canonical signals (`facility.incident.created`, `twin.state.updated`) pass through it with zero effect, confirmed by this slice's test suite. Long-term, notification dispatch belongs downstream of Core's own awareness/recommendation output (as the convergence diagram specifies: reasoning → recommendation → capability → workflow → action, not raw signal → notification), not a flat signal-type switch. Migrate community/wallet notification triggers into that path in a later wave; until then this is a legitimate compatibility shim, not dead code. |
| `subscribers/realtimeSubscriber.ts` | Calls `oyiCoreRuntime.decorateRealtimePayload(event, signal, [])` for **every** signal, unconditionally (no type gating at all) | **MIGRATE INTO OYI CORE — and flagged as the slice's most important finding** | `decorateRealtimePayload()` itself calls `oyiCoreRuntime.receiveSignal()` a **second time** with a reshaped payload, then `emitRealtime()` broadcasts a second, real socket.io event into the same estate/room/user/device rooms. This means any signal that reaches `handleSignal()` is processed by Core **twice** and broadcast **twice** — confirmed by direct code reading this slice, and independently reconfirmed by this slice's disclosure test showing the *pre-existing*, unrelated `emitSignal()` → `decorateRealtimePayload()` → `receiveSignal()` chain already does the same thing whenever a live socket.io server is attached (i.e., in normal production operation). This is precisely why this slice's `canonicalSignalIngress.ts` adapter calls `receiveSignal()` directly instead of `handleSignal()`. **Recommendation for the next wave that touches control-plane:** make `decorateRealtimePayload()` presentation-only (strip its internal `receiveSignal()` call) so realtime decoration and canonical ingestion are cleanly separated — this fixes the ambient duplicate for every existing `emitSignal()`/`handleSignal()` caller in the codebase, not just this slice's two producers. This is a bigger, shared-infrastructure change and was correctly out of scope for this slice's "smallest reusable pattern" mandate; it should not be deferred indefinitely, since every future "add canonical ingress alongside broadcast" migration (cameras, Office workflows, etc.) will inherit the same double-processing problem until it's fixed. |
| `capabilities/deviceCapabilities.ts` | A static `DEVICE_CAPABILITIES[deviceType] → allowed command types` lookup table, consumed only by `deviceCapability.policy.ts` | **MIGRATE INTO OYI CORE** (alongside its one consumer) | Not infrastructure in its own right — it exists solely to back the duplicated authority check above. Once `deviceCapability.policy.ts` migrates into `CapabilityService`, this table should move with it (or be superseded by `CapabilityRegistry`'s own per-capability `scope_requirements`/`permission_requirements` if those already cover the same ground — worth checking in that future wave rather than assuming). |

## Summary disposition

- **Genuinely infrastructure, keep:** the `Signal` contract/schema types (with the caveat that `NormalizedSignal` is the actually-canonical shape, not this narrower union).
- **Router logic worth keeping, but only the first line:** `handleSignal()`'s `receiveSignal()` call.
- **Duplicated intelligence/authority/execution, migrate into Core:** `decisionEngine.ts`, the four non-stub policies, `intentWorker.ts`, `deviceCapabilities.ts`.
- **Empty stubs, retire whenever convenient:** `energy.policy.ts`, `security.policy.ts`.
- **Real, safe-for-now compatibility shim:** `notificationSubscriber.ts`.
- **The one confirmed architectural defect requiring dedicated attention before further signal-ingress migrations compound it:** `realtimeSubscriber.ts` / `decorateRealtimePayload()`'s double `receiveSignal()` invocation.

## What this slice deliberately did NOT do

Per the governing instruction for this slice, none of the above was retired, rewired, or migrated. `src/core/control-plane` is untouched. This document exists so that Wave 4/5 (action/control bypass migration) and any future signal-ingress wave can proceed with a real answer to "does control-plane still matter here" instead of re-deriving it, and so the `decorateRealtimePayload()` double-invocation is a known, tracked item rather than something the next engineer rediscovers by accident.
