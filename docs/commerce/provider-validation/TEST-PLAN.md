# Phase4E isolated provider validation — approval package

Status: PREPARATION ONLY. Real provider transactions/refunds not executed. No accounts, keys, tunnel, webhook setting or production resources created/changed. Backend source candidate a416190 with proposed scoped UUID remediation; Office26083b7; GetOyi8df4f3e. Production Hardware and live payments remain NO-GO/OFF.

## Minimum temporary architecture
One developer machine with a disposable Docker network and fresh volumes can host the test stack; no Render/Vercel production deployment is necessary:

1. Separate Office PostgreSQL/PostgREST instance, schema-only local migrations through4E, synthetic catalogue/CRM/orders and two synthetic refund actors.
2. Separate Backend PostgreSQL/PostgREST instance containing only hardware payment/recovery schema. No wallet tables, production dump, customers, production connection strings or production service-role keys.
3. Isolated Office process, hardware-only Backend entrypoint using existing payment handlers/recovery service, and test GetOyi process. Do not start the full Backend workers/device adapters or wallet routes. The dedicated hardware-only executable still needs preparation; do not assume current app.ts is isolated merely because routes differ.
4. Local HTTPS reverse proxy: Office/Backend service calls stay private; test GetOyi origin accessible only to approved testers. Exact production HTTPS URLs denied. Provider egress allowed only to api.paystack.co; deny production database and Office domains.
5. One temporary public HTTPS ingress exposes POST /hardware-payments/webhook only, with raw body limit256KB and existing signature verification. All wallet/administrative/other routes return404/deny. Do not put interactive login in front of the Paystack webhook. No body/header logging. No relay to production.
6. Test browser uses a separate profile and synthetic guest identity. Existing production staff cookies never copied. Card testing occurs on Paystack-hosted checkout only.

The public test ingress must exist for Paystack callbacks; the test storefront is access-controlled and advertises no products publicly. Only the isolated GetOyi process may enable its local catalogue/checkout flags for rehearsal. Production HARDWARE_CATALOGUE_ENABLED remains false.

## Verification state and missing setup
|Requirement|Current evidence|State|
|Dedicated test merchant/integration and key|User confirms none established; no secret value inspected|BLOCKED|
|No production wallet connection|Source separates hardware tables/signing key; proposed minimal entrypoint/network not provisioned|NOT YET VERIFIED AT RUNTIME|
|Separate Office/Backend DBs|Disposable regression fixture demonstrated separate DBs; no persistent provider-test environment provisioned|SETUP REQUIRED|
|Dedicated webhook|Existing raw hardware route verified with synthetic signatures; no approved test hostname/dashboard binding|BLOCKED|
|Callback isolated|paymentCallback currently permits production getoyi.com/www only|LOCAL ALLOWLIST CHANGE REQUIRED BEFORE TEST|
|No production customer records|Proposed synthetic-only seed; production clone prohibited|SEED/DB INVENTORY REQUIRED|

Two approvals are separate: first authorize the named test environment/setup (including any new test integration and its test webhook); then, after read-only/nonfinancial isolation preflight passes, authorize the bounded transaction/refund run. Existing Paystack settings must not be edited under this task. If a new integration cannot have an independent test webhook, stop and request a separately approved alternative; never repoint the wallet merchant webhook.

## Exact configuration contract
No values should appear in chat, evidence or Git. Provision only after setup authorization into an untracked local secret store; log presence/mode checks only.

Backend: HARDWARE_PAYSTACK_SECRET_KEY (dedicated sk_test_); HARDWARE_PAYSTACK_CALLBACK_URL (exact isolated HTTPS origin plus /hardware/checkout); HARDWARE_OFFICE_API_KEY; OFFICE_HARDWARE_PAYMENT_CONFIRM_URL and OFFICE_HARDWARE_PAYMENT_CONFIRM_KEY (isolated Office /api/commerce/payments/confirm, commerce.payment.confirm only); OFFICE_HARDWARE_FINANCIAL_URL and OFFICE_HARDWARE_FINANCIAL_KEY (isolated Office /api/commerce/payments/operations, commerce.payment.operations only); SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for fresh Backend DB. No PAYSTACK_SECRET_KEY or PAYSTACK_SECRECT_KEY. HARDWARE_PAYMENT_INITIALIZATION_ENABLED, HARDWARE_PAYMENT_PROCESSING_ENABLED, HARDWARE_FINANCIAL_RECOVERY_ENABLED and HARDWARE_REFUNDS_ENABLED false until staged authorization.

Office: fresh DB URL/role key, local Office origin/session secret; HARDWARE_PAYMENT_BACKEND_URL/KEY only test Backend. OFFICE_HARDWARE_ORDERS_ENABLED, OFFICE_HARDWARE_PAYMENTS_ENABLED, OFFICE_HARDWARE_PAYMENT_PROCESSING_ENABLED and OFFICE_HARDWARE_FINANCIAL_ENABLED enabled only in the isolated run. Existing scoped-key configuration contains separate checkout, confirmation and financial-operations keys; no intake credential copied. Mail/SMS/CRM outbound integrations disabled or local sinks. Refund requester and different approver have explicit read/request/approve scopes; never bypass self-approval.

GetOyi: OCHIGA_OFFICE_CHECKOUT_URL, OCHIGA_OFFICE_CHECKOUT_KEY (commerce.checkout.submit only), HARDWARE_CHECKOUT_SESSION_SECRET and GETOYI_CHECKOUT_ORIGIN bound to test environment. HARDWARE_CATALOGUE_ENABLED, HARDWARE_CHECKOUT_ENABLED, HARDWARE_PAYMENTS_ENABLED enabled only in inaccessible isolated rehearsal, never production.

Required callback patch: explicit configured test origin pinned by the rehearsal, test-key-only, exact /hardware/checkout; reject arbitrary request-provided URLs, production origins in test mode, credentials, query, fragments and alternate ports. The production allowlist must not be broadened generically. Patch/tests require review before run.

## Preflight before monetary test API calls
- Record exact commit hashes, image digests, DB identifiers and migration/gate hashes; validate both fresh schemas with existing gates.
- Inventory tables/row counts to show synthetic-only data and no Backend wallets. Confirm no production configuration bindings or inherited shell secrets; fail closed if uncertain.
- Owner verifies test integration identity/mode and independently controlled webhook destination; verify key prefix without logging the key. A prefix alone does not establish correct account/isolation.
- Test DNS/network allow/deny routes; wallet ingress must be inaccessible, Office scoped keys cannot access unrelated routes, unknown callbacks rejected.
- Synthetic malformed-signature request must get401 and no payment transition. Synthetic signed event remains labelled simulated and cannot prove provider delivery.
- Keep initialization/refunds OFF until a second explicit transaction authorization. If a gate fails, stop without retrying a financial operation.

## Proposed bounded scenario run (requires separate approval)
Proposed cap: at most12 test payments of exactly10000 kobo each (NGN100, fixture-approved total), at most3 full-refund initiations, no live funds. Use distinct run-tagged orders/references, verified fixture stock and separately approved fixture prices. Stop on an unexpected amount, domain, account, destination, duplicate initiation or missing audit. No blind retries. Exact test identities/inboxes, URLs and limits must be approved first.

|Scenario|Execution after approval|Evidence and expected result|Evidence class|
|Successful payment|Hosted test checkout using Paystack documented success card|Provider verify returns test/success/exact reference+NGN+kobo+metadata; one Office confirmation, one stock allocation; UI Payment verified|Real provider|
|Failed payment|Use documented declined test card|Record actual provider verification response; no paid order/allocation; no assumption every failure sends webhook|Real provider|
|Duplicate webhook|Retain actual provider event transiently in memory and replay to isolated ingress, or approved dashboard resend|Single digest/final confirmation/allocation; record whether replay was client-driven or provider resend; no signed payload retained in report|Real event plus controlled replay|
|Redirect without verification|Open callback before completing hosted payment with reference query|No paid transition or allocation; UI remains unconfirmed until server evidence|Local browser manipulation + provider pending state|
|Amount/reference mismatch|Inject altered verification result through a test-only fault adapter, never falsify provider logs|Rejected/manual reconciliation; no allocation. Actual provider response retained separately as sanitized facts|Simulated verification fault, not provider mismatch|
|Expired reservation|Initialize test payment, wait actual hold TTL, then complete checkout|Verified funds → refund_required, no stock allocation or oversell; UI explicitly requires Sales/refund|Real payment + controlled timing|
|Timeout/delayed success|Local proxy drops initialization/verify response or delays delivery, then restore|Persist uncertain intent; lookup original reference; no second initialization; eventual evidence reconciles|Real payment plus simulated network fault, not provider outage|
|Office confirmation failure|Temporarily deny only isolated confirmation route, complete payment, restore and run worker|Durable verified Backend proof survives; one Office confirmation on retry, no duplicate allocation|Real payment + injected Office outage|
|Refund-required classification|Reuse expired/cancelled isolated order with actual test success|Exact received amount retained, refund_required audited; no automatic unavailable-stock allocation|Real provider + controlled order state|
|Refund initiation/completion|Requester and independent approver approve eligible full refund; worker POST once, poll/refund webhook|Exact test transaction/refund amount/currency/reference; pending stays pending; processed only after verified matching evidence; bank arrival never asserted|Real provider if supported; otherwise BLOCKED, not substituted silently|
|Failed/needs-attention refund (within cap)|Use documented refund-specific test cards for separate payments|Actual returned status escalates; no false funds-returned message|Real provider where supported|

Paystack test cards and supported refund error scenarios: https://paystack.com/docs/payments/test-payments/
Refund API: https://paystack.com/docs/api/refund/
Disputes: https://paystack.com/docs/api/dispute/
Test refund completion and the no-dispute response contract must be observed, not assumed. Unsupported scenarios remain unresolved or explicitly dispositioned; mocked tests do not become real-provider PASS.

## Cross-service acceptance query checklist
For each run-tagged order compare immutable Office authorization/snapshot total, order and reservation IDs, Backend payment reference/proof/provider transaction ID, all confirmation records and inventory history. Require one effective confirmation/allocation despite concurrent callback/webhook/worker. For expired/cancelled orders require zero allocation and refund_required. For refunds match request/independent decision/Backend intent/provider refund ID and amount/Office observation hash; notes cannot establish repayment. Query only synthetic rows, exclude customer payloads and tokens.

Check guest ownership isolation and UI in browser: pending, verified, refund-required, refund-pending, refund-processed and escalation labels. Specifically bank arrival remains unconfirmed even after provider processed. Verify a second guest cannot inspect the order. Preserve original payment fact and immutable history after refund.

## Evidence and teardown
Record run ID, candidate hashes, scenario class, expected/actual kobo, reference/provider ID, verified test status, UTC timestamps, event digest, row/event counts, reservation state and redacted UI result. Never record secrets, auth headers, cookies, raw customer payloads or signed/hosted checkout URLs.
Disable new initialization/refund initiation first; reconcile every initiated attempt before closing. Retain sanitized evidence; stop isolated worker, remove ingress, dispose synthetic volumes only after review. Any test-integration setting cleanup needs its own authorized owner action. Do not alter existing production settings.

Verdict: architecture ready for approval; runtime isolation NOT verified; provider execution BLOCKED. Production release/public activation/live payments NO-GO. Phase3 independent production release/withdrawal gate remains outstanding.
