# Bounded isolated hardware execution

Default disabled. Preparation and tests do not authorize provider transactions.

## Single initialization only

The `single-init-manifest.json` profile is narrower than the multi-scenario runner: one plan item, one `single_initialization` payment intent, a 10,000-kobo cap, and zero refunds, provider reads, or webhook replays. The relay accepts only `POST /transaction/initialize` in this profile. A valid initialization response or any uncertain/malformed outcome makes the run terminal; a restart cannot mint another dispatch ticket for the same intent. The controller accepts only `initialize single_initialization`; the execution server profile exposes no reconciliation, recovery, replay, refund, or webhook-processing route. Payment processing, recovery, and refund flags must remain false.

The provider relay can be started for isolated preparation with `PROVIDER_FINANCIAL_RELAY_ENABLED=true` while `PROVIDER_FINANCIAL_EXECUTION_ENABLED=false`. It loads the single-init plan and applies provider-only egress, but the disabled durable ledger rejects every dispatch before `send()`. The separate bounded Backend remains on setup-only mode until a later, exact execution authorization. Both flags default false in the image.

## Single payment acceptance (one complete Test Mode lifecycle)

`single-payment-manifest.json` (`single-payment-acceptance`) covers one hardware-order payment end to end:
- 1 initialization of exactly 10,000 kobo;
- at most 3 provider reads, each `GET /transaction/verify/<the run's own reference>`;
- 0 refunds, 0 replays, 0 second initializations;
- a 30-minute run window.

It reuses the same ledger, tickets, relay and durable counter (budget `initialize=1, read=3, refund=0`).

- **Ledger and bridge.**
  - Only the `single_payment` scenario: one `payment` intent bound to the plan reference and amount, plus `read` intents.
  - A read before the initialization exists, any refund or replay claim, a second initialization, or an amount change stops the run.
  - An uncertain initialization does **not** stop the run. Verification reads of the original reference resolve it, and the initialization is never repeated.
- **Relay.** It accepts only `POST /transaction/initialize` and `GET /transaction/verify/{payload reference}`. Refund, refund-list and dispute routes are refused before the ticket is consumed or the counter is touched.
- **Bounded Backend** (`HARDWARE_EXECUTION_PROFILE=single-payment-acceptance`).
  - Flags: initialization and processing `true`; recovery and refunds `false`.
  - Routes: `POST /hardware-payments/initialize`; `POST /hardware-payments/webhook` (raw, 64 KB, HMAC-SHA512, 30/min); `POST /hardware-payments/reconcile`, whose body must be exactly `{reference}` so a sweep is impossible. Nothing else, and errors carry no stack traces.
  - Verification goes through `HardwarePayments.reconcile` only. `HardwareRecovery`, with its second verify read and dispute read, and sweeps are disabled.
  - The config's profile must equal the environment profile.
- **Webhook.** A signed event is recorded idempotently (inbox keyed by body digest) and marks the attempt due; it is a hint only. Office is confirmed solely from a verification read whose test domain, reference, NGN amount and order, reservation and authorization metadata all match.
  - An unsigned or wrongly signed request returns 401 and is durably noted (`webhook_signature_rejected`) **without stopping the run**, so a reachable ingress cannot block the verification that settles the authorized payment.
  - Rate limiting is noted once per window.
- **Controller.** `run.cjs initialize single_payment`, then `run.cjs verify single_payment` (at most three times per run; each prints the ledger state).
- **Preparation.** `prepare-single-run.py --prepare --profile single-payment` creates the fresh order and hold, the disabled ledger and the counter (budget `initialize=1, read=3, refund=0`).
  - Synthetic customers are `setup-<scenario>-<run>@example.invalid`, as the relay initialization policy requires.
  - The earlier `single-init-…` customer pattern would have been refused before any send.

Phase 4K corrections:
- **Canonical route gate (all bounded profiles).**
  - The raw request target must be exactly `/hardware-payments/<lowercase name>`, checked before any router, parser or handler.
  - Refused: `//reconcile`, a trailing slash, a query, dot segments, percent-encoding, backslashes and upper case.
  - Express had routed `POST /hardware-payments//reconcile {}` to the sweep handler; the sweep itself was already denied in this profile.
- **Approved test inbox.**
  - A single-payment manifest must carry `customer_email`: a deliverable, owner-approved inbox; reserved domains (`example.*`, `.invalid`, `.test`, `.localhost`) are refused.
  - `prepare-single-run.py --customer-email` adds it to the run's manifest, so the authorization hash binds it, and the relay policy requires that exact address.
  - The committed template carries no address.
- **Reservation hold.**
  - `run.cjs initialize` refuses (`reservation_hold_insufficient`) before Office payment-start if fewer than 600 s of live hold remain.
  - `run.cjs hold single_payment` reports the remaining seconds and `checkout_allowed` (≥300 s) from Office's checkout status, with no provider call.

Tests:
- `test_single_payment.py`: ledger and bridge, 14 tests.
- `test-single-payment-runtime.cjs`: relay routes, counter budget and restart, flags, HTTP surface, canonical routes, inbox binding, strict amount and hold rule; 107 assertions.
- `scripts/test-single-payment-cases.js`: the end-to-end Postgres chain (`TEST_SINGLE_PAYMENT=true`), with a fake Paystack behind the real relay handler, counter, ledger, Backend SQL and Office confirmation SQL.

## Existing financial authority
`integration.cjs` wraps the existing `HardwarePayments`, `HardwareRecovery`, initialization router, raw webhook handler and Office confirmation/financial-operation dependencies. PostgreSQL payment/refund ledgers and Office reservations remain authoritative. SQLite stores execution budgets, dispatch tickets and redacted outcomes only; it never credits a wallet or marks an Office order paid.

`hardwareRecoveryDependencies()` exposes the existing dependency construction without changing the ordinary production factory. `execution-server.cjs` is a separate hardware-only entrypoint. With no explicit enable flag it runs the existing setup-only server. It never imports the application/wallet entrypoint or starts workers.

## Durable limits and dispatch
- 12 payment initializations,10000 kobo each,120000 aggregate.
- 3 full refunds, each matching verified payment amount and an independently approved Office request.
- 60 provider reads,3 controlled webhook replays,60 minutes. One payment/refund initiation per scenario;10 reads per scenario.
- The immutable plan binds scenario, reference and amount. Exact manifest and plan approval is required to arm. Default runtime state is disabled.
- SQLite WAL/FULL transactions reserve intent and budget before transport. Immutable financial fields/history and integrity/schema checks fail closed. Missing state is never recreated by execution.
- Each dispatch gets a random single-use ticket bound to method/path/body hash. The relay consumes it durably before sending. Concurrent replay cannot send twice.
- Unknown or interrupted sends block further financial POSTs while allowing bounded verification reads. A restart never refunds or initializes again merely because the response was lost. Existing PostgreSQL leases/outboxes prevent duplicate confirmation and allocation.

## Recovery
Initialization uncertainty verifies the original reference through the existing service. Verification validates test domain, reference, NGN amount and order/reservation/authorization metadata before Office confirmation. A verified PostgreSQL row survives failed Office delivery and is retried idempotently without requiring another provider read. Refund uncertainty searches bounded provider refund pages for the existing approval marker; it never resubmits the POST. Missing or multiple matches stay unresolved/escalated. No returned initialization URL, browser redirect, webhook hint or run-ledger entry is final financial proof.

`run.cjs initialize <scenario>` calls the existing scoped Office payment-start endpoint, which authorizes and invokes Backend initialization. `reconcile` uses a reference-scoped sweep of existing recovery services. `replay` generates an explicitly labelled injected signed hint; it does not claim to be an original Paystack delivery. All require an already armed run. Private hosted results are saved0600, never printed. Repeated initialization commands reuse the private result file; service/DB idempotency remains authoritative.

## Provider boundary
The application stays on the private network. `relay-client.cjs` has one fixed internal endpoint. `financial-relay.cjs` accepts only ticketed `/financial` calls and only the reviewed Paystack paths; it cannot CONNECT or follow redirects. Upstream is fixed `api.paystack.co:443`, TLS hostname/certificate verification required, DNS-pinned public IPv4 addresses, kernel default-deny IPv4/IPv6 egress, then unprivileged UID. No request/response bodies or keys are logged. The dedicated test signing key is read from the existing exact read-only mount; no wallet credential fallback.

### Durable provider-request counter
`provider-counter.cjs` is an independent witness on its own volume (`/run/provider-counter`, `hardware-provider-counter-single-<run>`), separate from the run ledger. `prepare-single-run.py` creates a fresh counter for each prepared run, bound to that run's plan SHA-256 with budget `initialize=1, read=0, refund=0`; it is never reused. An enabled relay refuses to start if the counter is missing, mismatched, unsafe, tampered (hash chain), locked by another or crashed relay, or has an unresolved dispatch. After the ledger ticket is consumed and before `send()`, the relay appends an fsynced `dispatch` record; a budget or write failure sends nothing (429 `provider_request_budget_exhausted` or 503). A `completion` record follows with the safe outcome class, upstream status and duration. Records contain no reference, URL, body, header, key or amount. `GET /counters` (private network) and `node provider-counter.cjs --inspect <dir>` (read-only mount) report totals and the file hash.

Kernel backstop: OUTPUT is default-deny. Comment-tagged rules count NEW TCP connections to the pinned provider addresses (`getoyi-provider-new`) and denied packets (`getoyi-denied`). Read them with `docker exec <relay> iptables -L OUTPUT -v -x -n` before and after a test.

Routes: POST /transaction/initialize; GET /transaction/verify/{owned-reference}; POST /refund (owned reference, full amount, NGN and approved marker); GET /refund/{owned-id}; GET /refund?transaction={owned-id}&perPage=100&page={1..10}; GET /dispute/transaction/{owned-id}. No other host, method, query or financial destination. Budget tickets cannot be replayed or changed to another route/body.

The public tunnel remains exclusively POST /hardware-payments/webhook. Initialization/recovery/refund control stays private and authenticated. Office's internal HTTPS `/backend/hardware-payments/initialize` gateway path reuses the existing local certificate; its public tunnel listener is unchanged.

## Preparation and later authorization
1. Build the image locally from a credential-free context containing only this directory and dist/commerce. Dockerfile defaults both execution flagsfalse.
2. Run `python3 release/provider-execution/prepare-run.py --prepare` shortly before the proposed run. It uses existing isolated Office staff/checkout workflows to produce fresh synthetic orders and holds, creates a disabled ledger and an authorization-required.json with authorizedfalse. No Paystack request. It never modifies production accounts or permissions.
3. The script copies the ledger/config to its labelled Docker volume, UID/GID1000,0600 files/0700 directory. This avoids Docker Desktop root-owned host mounts. Local scoped service-key files are0600; the Paystack key is not copied. The volume is recorded for protected teardown.
4. Obtain separate explicit authorization for the exact manifest/plan and limits. Only afterward supply authorization.json and run control.py --arm-approved-run. Do not change authorization-required.json to true during preparation.
5. After approval only, mount the selected ledger volume at /run/execution in Backend/relay/controller; mount the existing dedicated test key read-only; mount only the required synthetic service keys in the controller. Attach applications only to the private network. The relay alone joins the existing dedicated egress network, with NET_ADMIN/SETUID/SETGID/DAC_OVERRIDE available for firewall setup/drop and no published port. Its ledger owner must be UID1000. The Backend starts root with only SETUID/SETGID, reads its root-owned read-only key, then drops to UID1000 before accessing the ledger. The relay drops privileges after firewall setup. Neither retains effective capabilities while serving requests. All deployments are disposable local services.
6. Use the prepared Office env binding to https://office.hardware.test/backend. Enable only isolated Office payment/confirmation gates and the bounded Backend/relay flags after approval; retain production/public Hardware flagsOFF. No unbounded default app or reconciliation worker is started. Preserve named stopped backups for rollback and record any replacement containers in setup state.
7. Before arming, run preflight.cjs against a fresh disabled ledger (preflight-plan is read-only and cannot issue dispatch tickets): current authoritative Office quote must show each synthetic order unpaid, eligible and exactly its approved amount≤10000. Expired holds cause a hard stop; use a newly prepared plan and fresh authorization instead of editing financial history. Confirm local certificate trust, guest test-session/order association, temporary webhook/dashboard destination and active signature guard before the first provider operation.
8. Initialize only named scenarios, at most once per intent. Hosted test-card interaction is performed in the isolated test browser. Run bounded reference-scoped reconciliation. Refunds require the separate synthetic requester and approver; the controller cannot approve refunds.

The single-use dispatch relay must be used for every provider call, including callbacks/recovery/refunds. Do not fall back to the ordinary direct Paystack client if the relay or ledger is unavailable.

## Stop, rollback and teardown
`control.py --disable` closes all new bounded operations. Mandatory mismatch, signature, budget or state failures stop the run permanently. Transport uncertainty preserves its original intent and permits only bounded reads. Do not reset counters or delete intents to resume.

Keep provider/Office evidence until every attempted operation is reconciled or explicitly dispositioned. Teardown checks both payment ledgers, host execution databases and every labelled execution volume; any intent or unavailable state refuses deletion. Volume checks use SQLite mode=ro, with writable mount only for WAL shared-memory bookkeeping. They run as UID1000 and do not modify financial rows. Never use immutable=1 to inspect a live WAL database.

Restore only recorded local stopped Backend/Office/GetOyi containers and the original probe-only relay when rolling back service configuration. Database history is not reversed. After evidence retention and authorized disposal, remove only labelled task containers/volumes/networks, recorded tunnel process and runtime secrets. Do not globally prune Docker or touch S7. Clear only dedicated2075190 TEST URLs when retiring the environment; never alter wallet/live settings.

## Evidence
`test_executor.py`: durable caps, restart, immutable history, mode/domain and interruption.
`test_bridge.py`: missing/tampered state, ticket concurrency/hash binding and read-only recovery.
`test-policy.cjs`: exact routes and amounts.
`scripts/test-bounded-relay.cjs`: real local HTTP single-use dispatch with mocked upstream, no provider requests.
Office disposable financial suite with TEST_BOUNDED_EXECUTOR=true invokes scripts/test-bounded-executor-cases.js: real PostgreSQL ledgers, existing HTTP initialization/webhook routes and services, mocked provider plus explicitly injected failures. This is preparation evidence, not real Paystack behavior.
