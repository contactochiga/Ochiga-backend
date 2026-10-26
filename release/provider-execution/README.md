# Bounded isolated hardware execution

Default disabled. Preparation and tests do not authorize provider transactions.

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
