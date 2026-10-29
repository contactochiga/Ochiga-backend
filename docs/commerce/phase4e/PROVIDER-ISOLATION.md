# Paystack isolation approval plan — no configuration applied

User confirms no dedicated Hardware test configuration exists. Real provider validation is BLOCKED. No real transaction/refund or dashboard change was attempted. Source audit only; production secret presence, mode and dashboard bindings are not certified.

## Existing configuration and routes
- `src/utils/paystack.ts`: shared Axios transport reads PAYSTACK_SECRET_KEY by default.
- `src/controllers/walletController.ts`: legacy wallet secret resolves PAYSTACK_SECRET_KEY or historical PAYSTACK_SECRECT_KEY; `/wallets/webhook` handles wallet events. Neither variable nor financial behavior is changed.
- `src/app.ts`: raw `/hardware-payments/webhook` is separate; shared wallet ingress diverts hwo_ charge references to hardware. This fallback is NOT an isolated test destination and must not be used.
- Hardware requests explicitly override transport authorization with HARDWARE_PAYSTACK_SECRET_KEY, require sk_test_ and verify provider domain=test. No fallback to wallet credentials.
- Hardware webhook verifies SHA512 against exact raw bytes and stores a digest; provider verification is still required.
- Existing callback validation only allows https://getoyi.com/hardware/checkout or www equivalent. This is a blocker for a fully isolated provider rehearsal: approve an explicit test-origin allowlist change before real tests. No production callback will be used.

## Minimum configuration for approval
Use a dedicated company-controlled Paystack test integration/account, isolated Backend, Office and GetOyi instances and separate databases. Do not modify the wallet merchant's live or test webhook setting. If Paystack cannot isolate a test webhook within the existing account, use a separate approved integration/account.

Backend names (values must be provisioned separately, never in Git/logs):
- HARDWARE_PAYSTACK_SECRET_KEY: dedicated sk_test_ credential, verified in owner dashboard; no production credential.
- HARDWARE_PAYSTACK_CALLBACK_URL: approved isolated HTTPS GetOyi `/hardware/checkout`, after explicit allowlist support.
- HARDWARE_OFFICE_API_KEY: synthetic test service credential used only by isolated Office.
- OFFICE_HARDWARE_PAYMENT_CONFIRM_URL / OFFICE_HARDWARE_PAYMENT_CONFIRM_KEY: isolated Office `/api/commerce/payments/confirm`, scope commerce.payment.confirm only.
- OFFICE_HARDWARE_FINANCIAL_URL / OFFICE_HARDWARE_FINANCIAL_KEY: isolated Office `/api/commerce/payments/operations`, scope commerce.payment.operations only.
- SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY: disposable Backend database only; separate from Office database and production.
- HARDWARE_PAYMENT_INITIALIZATION_ENABLED, HARDWARE_PAYMENT_PROCESSING_ENABLED, HARDWARE_FINANCIAL_RECOVERY_ENABLED, HARDWARE_REFUNDS_ENABLED: false by default; enable only in reviewed isolated run.
- No PAYSTACK_SECRET_KEY/PAYSTACK_SECRECT_KEY in isolated hardware worker; wallet routes must not be externally reachable.

Office: isolated database bindings; HARDWARE_PAYMENT_BACKEND_URL and HARDWARE_PAYMENT_BACKEND_KEY target isolated Backend; OFFICE_HARDWARE_ORDERS_ENABLED, OFFICE_HARDWARE_PAYMENTS_ENABLED, OFFICE_HARDWARE_PAYMENT_PROCESSING_ENABLED, OFFICE_HARDWARE_FINANCIAL_ENABLED enabled only for rehearsal; scoped integration keys limited to named routes. Two synthetic staff actors have explicit refund request/approval scopes; no production grants.

GetOyi: isolated Office checkout binding and guest signing secret. HARDWARE_CATALOGUE_ENABLED remains false in production. Only an inaccessible isolated rehearsal may expose checkout; no production flag changes.

Dashboard test webhook destination: exact isolated HTTPS `/hardware-payments/webhook` only. No forwarding to `/wallets/webhook`, no production host. Expose only that route through a controlled HTTPS endpoint; disallow request/response body logging. Approval must name owner/integration identifier, test mode and exact callback/webhook origins (no secrets).

## Verification before transactions
1. Confirm isolated URLs, database identities, account test mode, key prefix without printing values, flags and route firewall. Record non-secret metadata only.
2. Deliver a synthetic bad-signature event to isolated hardware route and require401; wallet route inaccessible. Verify no production routing.
3. Approve limited synthetic NGN scenarios, hosted test-card entry by account owner where needed; never collect card details in Office/GetOyi.
4. Record reference, provider test domain/status, expected/actual kobo and evidence hashes; omit customer/provider raw responses.
5. Exercise success, pending, timeout/retry, duplicate webhook, failed Office confirmation, expired/cancelled order, exact full refund, failed/partial refund and dispute escalation where provider supports simulation. Unsupported scenarios retain mocked evidence and explicit limitation.
6. Disable isolated initialization/refunds after run, retain recovery until all initiated operations reconciled; remove tunnel and dispose only synthetic data after evidence retention.

Provider contracts: https://paystack.com/docs/api/refund/ and https://paystack.com/docs/api/dispute/. Refund create has no documented generic idempotency header: persist intent before POST; uncertain outcome is recovered by provider lookup, never blind retry. Dispute endpoint documentation shows an object response despite its List title: unknown/no-dispute response contracts fail closed and require real test confirmation before enablement.
