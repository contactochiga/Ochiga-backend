# Isolated provider environment — setup report

Setup-only verification: **48/48 PASS**. Real provider transactions: **NO-GO / NOT AUTHORIZED**. Production/public Hardware/live payments remain NO-GO. No production configuration, Paystack dashboard setting, account, credential or data was changed.

## Running local environment
- GetOyi: https://localhost:18443/hardware (existing static Hardware; catalogue/checkout/payments OFF).
- Office: https://localhost:18445 (test-only). Two generated non-admin users at setup-requester@example.invalid and setup-reviewer@example.invalid; credentials remain in runtime/staff-credentials.json (0600), not this report.
- Callback allowlist: exactly https://localhost:18443/hardware/checkout, accepted only through the explicit setup-origin branch. Other origins, ports, query strings, fragments and production GetOyi callbacks are denied in setup mode. The frontend payment route remains disabled.
- Public HTTPS webhook destination: webhook-destination.txt. Temporary Cloudflare quick tunnel with clean HOME and no account certificate/config loaded. Only exact POST /hardware-payments/webhook is forwarded. No existing DNS record or Paystack setting changed. GET, wallet, initialization, query-suffixed and unrelated paths return404.
- Local certificate lasts two days and is trusted only by these services/test requests. No global trust-store change. A browser may require explicit local certificate acceptance before manual use. JWTs expire after24h; recreate/renew isolated bindings before a later test session.

## Verified controls
- Office and Backend have separate fresh PostgreSQL containers and separate signing credentials; Backend key receives401 against Office DB. Both exact Stage4E schema gates PASS.
- Backend has no wallet relations. Office holds one synthetic contact, two synthetic staff, one unpublished synthetic draft and schema seed taxonomy. No production dump or customer records used. Zero payment attempts/confirmations/refunds.
- All three application containers attach only to an internal Docker network. Production GetOyi, api.paystack.co and public-IP HTTPS probes fail; host HTTPS access fails. No production environment files mounted, no inherited wallet/email credentials.
- The gateway alone also attaches to an ingress bridge with outbound masquerading disabled, allowing loopback port forwarding. Its public-egress probe fails. It forwards only fixed internal destinations. Browser CSP restricts connections/forms/frames to the local test environment.
- Provider signing uses a generated sk_test_SETUP_ synthetic string, not a Paystack key. Invalid signatures401; a correctly signed synthetic event503. Initialization, reconciliation, refunds and webhook processing cannot run in the setup executable. No valid payment webhook was submitted to Paystack or production.
- GetOyi reaches Office's scoped quote validation (400 for empty lines), Office operations key reads its empty refund queue (200), and that key cannot confirm payment (403). Backend reads its own empty ledger.
- Missing configuration and forbidden wallet credentials cause startup refusal. 21 startup/callback tests PASS; Backend payment/HTTP/webhook regressions33 PASS; Office scoped-key regressions35 PASS; financial HTTP checks8 plus7 scope/storage assertions PASS.

## Defect found and fixed locally
Stage4E registered commerce.payment.operations in route dispatch but omitted it from KNOWN_API_KEY_SCOPES in Office config.js. Real configuration parsing discarded the key, causing401. Added only that scope to the parser and a regression test. The real isolated server now authenticates it and denies confirmation. No production permission grant or credential change.

## Secure credential injection
inject-test-key.py prompts with hidden input and writes a new runtime/provider-test-key file with0600 permissions, refusing live prefixes and overwrites. It does NOT load or activate the key. Do not paste keys into chat or command arguments. No real provider credential is currently stored. Runtime directory0700; environment/state files0600; these contain only generated synthetic setup credentials and are excluded from Git.

## Remaining requirements before provider testing
1. Owner supplies/approves a dedicated Paystack test integration, its identity and test credential through secure local injection. Do not reuse or repoint the resident-wallet integration.
2. Separately authorize binding the dedicated integration's TEST webhook to the current temporary URL. None was configured here; quick-tunnel URL changes on recreation and is not a stable long-term environment.
3. Prepare/review a separately gated transaction runner and narrow provider-only egress. This setup executable intentionally refuses all financial processing; do not weaken it or use the production app entrypoint as a shortcut.
4. Approve bounded scenario IDs/amounts and actual test transaction/refund execution after renewed isolation checks. Seed approved test-only prices, stock, delivery and orders through the existing workflows then; current product is deliberately unpublished and unpriced.
5. Verify Paystack account/domain, refund and dispute response contracts during the separately authorized run. Mocked/synthetic HTTP evidence is not real-provider validation.

## Dependency disposition
Fresh audit: 0 Critical,5 High,1 Moderate,1 Low. No additional major upgrade made. Five High entries: ip + inherited node-ssdp; ip-address (old ip-cidr dependency); zod + inherited openai. Exact remediation/compatibility analysis remains in ../provider-validation/DEPENDENCY-REVIEW.md. Runtime import check loads none of these five packages in the hardware-only entrypoint. They remain installed and findings remain OPEN; isolation is not a production waiver. Replace discovery/IP dependencies and coordinate Zod/OpenAI migration with their regression coverage before general release, or obtain an explicit reviewed risk disposition. Resident-wallet accounting remains untouched.

## Reproduce and clean up
Executable sources are also committed under Backend release/provider-setup. Run build.py, setup.py, then seed.py from ONE chosen directory; do not run a duplicate stack while runtime/state.json exists. build.py stages tracked source plus compiled Backend, excludes environment files, and installs Linux dependencies. No production secrets enter build context. verify.py reruns read-only/nonfinancial checks.

The temporary tunnel was started with clean environment, --config /dev/null, --no-autoupdate, --url http://127.0.0.1:18444 and loopback metrics. The benign empty-config diagnostic is expected; no existing Cloudflare configuration was read. runtime/tunnel.pid identifies only this process.

Run python3 teardown.py from this directory to stop only the recorded tunnel and labelled containers, remove their disposable volumes/private networks and delete local synthetic keys/certificates. It refuses database removal if payment attempts/confirmations exist. It does not delete unrelated Docker resources, S7, production services or images. Retain verification.json/runtime-manifest.json and reports first. A later provider run must reconcile/archive financial evidence before teardown.

## Verdicts
- Setup-only local engineering: GO, subject to temporary certificate/token expiry.
- Actual Paystack test transactions/refunds: NO-GO until remaining setup and explicit transaction authorization.
- Production release, public Hardware activation and live payments: NO-GO. Independent production approval/release/withdrawal gate remains mandatory.
