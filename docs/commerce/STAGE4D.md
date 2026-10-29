# Stage 4D: dedicated hardware payments — local candidate

## Verified baseline and boundaries
Render Oyi-os, service srv-d4q66dadbo4c73bmrvtg, My Workspace, is live at 03e5090e30c75edbb563360504a432c0fa345c7e, deployment dep-db8ahve0tbcc73ebqra0. GitHub main matched this commit at inspection. This worktree branches from that exact revision. Render is Free and auto-deploys main; no push/deploy/configuration change was performed.

The separate Documents/Ochiga-backend checkout at0271213 contains unrelated work and was not used as the base or modified. No S7 or unrelated service changes.

Reused src/utils/paystack.ts Axios transport, middleware/officeCredential.ts timing-safe credential comparison and existing raw-before-JSON webhook architecture. Existing services/providerWebhookEvents.ts is best-effort telemetry, so it was not used as the durable payment inbox. A dedicated immutable event ledger follows that recording pattern without resident IDs or provider/card payloads.

Wallet controller, wallet balances, credit RPCs and wallet transaction tables are unchanged. The legacy verifyPayment ownership fallback can accept provider metadata without a wallet userId. New hardware references must never reach that path: the wallet router now rejects hwo_ references in path, query and body, and shared webhook ingress routes that namespace to the hardware handler. This narrow domain guard is tested over actual HTTP. Broader legacy wallet ownership and small-amount conversion heuristics remain separate review items.

Source configuration audited: PAYSTACK_SECRET_KEY (legacy controller also supports misspelled PAYSTACK_SECRECT_KEY), WALLET_FUNDING_ENABLED, /wallets/webhook. Current production secret presence/mode, merchant ownership, settlement account and dashboard webhook settings were NOT read or certified; the connector did not expose a names-only environment view. No secret was retrieved or changed.

## Architecture
Office alone authorizes immutable NGN/kobo totals, confirmed delivery and a live reservation. Backend stores one dedicated hardware_payment_attempts record per Office order, with unique hwo_ reference, reservation and authorization hash. Persist-before-provider plus DB lease prevents duplicate initialization. Uncertain initialization is verified by the original reference; it is never blindly repeated.

Provider initialization uses hosted checkout.paystack.com only. Callback is fixed to HTTPS getoyi.com or www.getoyi.com /hardware/checkout, with no query, credentials or alternate port. Browser callback parameters are not proof. Client amounts are not authoritative.

Signed webhook bytes enter hardware_payment_inbox before200 acknowledgement. HMAC SHA512 uses constant-time comparison; missing/invalid signatures fail401, storage failures fail503. Unknown signed references are quarantined without order/wallet creation. Verification always queries the provider and matches exact integer amount, currency, domain, reference, order, reservation, purpose and authorization hash. Verified facts and immutable reconciliation events are stored before Office notification. The verified attempt is the durable outbox; Office failure retries without another charge. Leases expire after60 seconds and survive process loss.

Office confirmation atomically records evidence, checks commercial eligibility, consumes a valid reservation and projects paid state. Cancelled, released, expired or ineligible orders instead enter refund_required without allocating unavailable stock. Mismatches enter manual_reconciliation; no automatic refund/provider mutation is performed.

## Configuration contract — names only, no values provisioned
- HARDWARE_PAYMENT_INITIALIZATION_ENABLED: default OFF; controls new payments.
- HARDWARE_PAYMENT_PROCESSING_ENABLED: default OFF; webhook/recovery independent of initialization.
- HARDWARE_OFFICE_API_KEY: new direction-specific Office-to-Backend credential, minimum32 characters.
- HARDWARE_PAYSTACK_SECRET_KEY: dedicated test credential only; never falls back to or changes the wallet key. Per-request Authorization overrides the reused transport's default.
- HARDWARE_PAYSTACK_CALLBACK_URL: fixed allowlisted callback.
- OFFICE_HARDWARE_PAYMENT_CONFIRM_URL and OFFICE_HARDWARE_PAYMENT_CONFIRM_KEY: HTTPS, exact Office confirmation endpoint and narrow commerce.payment.confirm scope.

This candidate deliberately accepts only provider test domain and sk_test_ credentials; live enablement requires a separate reviewed extension and release. No provider key, account or live transaction was created or used. All provider tests are mocks.

## Recovery and migration
Apply supabase/migrations/20261026094951_hardware_payment_attempts.sql transactionally to the Backend database only, after separate approval. Run release/phase4d/security-gate.sql; require exact reviewed owner/grant/RLS/constraint/trigger/function shape. It does not replace existing Backend release gates.

Schedule node dist/commerce/reconcileHardwarePayments.js once per minute using a separately approved runner. No scheduler was provisioned. It sweeps up to100 due attempts; leases prevent overlap. A failed Office delivery makes the run fail, while durable evidence remains retryable. Monitor verified attempts awaiting Office, oldest due time, lease age, manual/refund-required counts and unknown inbox references. No always-on application loop is required, but an external runner is mandatory.

Disable new initialization first for rollback. Keep webhook verification, reconciliation, Office confirmation and all financial records until every possible provider outcome is resolved. Do not revert to the old wallet webhook dispatcher while hardware references may still receive payments. Retain the namespace guard. A pre-use migration transaction can roll back; no destructive post-use down migration is supplied.

## Release blockers
Production schemas/provider binding/scheduler/credentials remain unverified and unprovisioned. No live provider tests. Refund execution, stale-pending aging, operator reconciliation UI and broader recovery operations remain Stage4E. Production public activation still requires independent real staff approval/release/withdrawal verification.

npm audit --omit=dev reports13 inherited findings:1 critical,9 high,3 moderate; package-lock is unchanged. Critical proxy-addr (GHSA-jqcg-44mw-7w3h), high Axios and other existing dependencies require a separately reviewed upgrade and regression pass before release. Fixed provider paths, disabled redirects and no IP-based payment authorization reduce specific exposures but do not dispose of the advisories.

Provider references: https://paystack.com/docs/payments/webhooks/ and https://paystack.com/docs/payments/verify-payments/ . Mock tests do not certify merchant configuration or live settlement.
