# Paystack integration preparation — no transaction authorization

## Result
Local preparation PASS. Real Paystack test execution **NO-GO**. Dedicated integration identity/ownership, test credential and Paystack dashboard webhook binding remain **UNVERIFIED/BLOCKED**. The user repeated preparation scope but did not supply a separate integration ID. No account was invented, no key obtained from wallet configuration, and no Paystack dashboard setting changed.

## Network access established
Only `api.paystack.co:443` is needed by the server for initialization, verification, refund and dispute API calls. Hosted checkout uses `checkout.paystack.com` in the browser; the server does not need general access to it. Dashboard access is an owner/browser operation, not an application egress permission.

The preparation relay has its own container/network namespace. It resolves the exact API hostname at startup, rejects private/special peers, installs IPv4/IPv6 default-deny OUTPUT rules with only validated peer TCP443 permitted (plus established replies), then drops to UID1000 with zero effective capabilities. DNS changes require an explicit restart/review; there is no permissive fallback. TLS certificate and hostname validation remain enabled; redirects are not followed.

The application containers stay exclusively on the existing internal network. They can reach the relay privately, but still cannot directly reach Paystack or production/internet destinations. No public ports, credentials or host directories are mounted in the relay. Its read-only filesystem has only an ephemeral /run tmpfs.

The relay currently permits ONLY GET /probe, which performs an unauthenticated GET to the provider API root and returns destination/TLS/status metadata, not bodies, cookies or redirect URLs. At most five probes per process. It refuses Authorization headers, CONNECT, alternate hosts and every financial path/method. This is a preparation allowlist, not a transaction transport. A separately reviewed run must add the exact financial routes and enforce its approved budgets; do not open a generic CONNECT proxy.

Evidence:23/23 egress checks PASS. Real TLS API-root response200 observed; **zero financial API calls**. Negative cases include initialization/refund/verify paths, arbitrary host inputs, Supabase/wallet-labelled destination inputs, credential forwarding, CONNECT, unrelated public-IP ports443/5432/587, IPv6 default-deny and direct internet denial from all applications. The Supabase/wallet input tests prove relay policy denial; no real production database address/credential was retrieved or connected. Kernel default deny covers all non-allowlisted peers irrespective of hostname.

## Webhook status
The existing temporary destination in the environment-setup/webhook-destination.txt file was reverified over public HTTPS:
- Exact POST /hardware-payments/webhook: invalid signature401.
- Correctly signed synthetic event:503 processing-disabled; no ledger changes.
- GET, wallet, initialization and unrelated paths:404.

This proves ingress routing and synthetic signature handling, **not a Paystack account binding or real-provider delivery**. No dedicated test integration/key is available. Current runtime still uses a generated setup-only signer. Optional real TEST signing-key support has been prepared and tested: exact read-only /run/secrets/hardware-test-key mount, mode0600, regular non-symlink file, sk_test_ only, no live key, no environment export/fallback. This optional key affects webhook verification only; payment factory and processing guards stay disabled. It is not mounted or activated now.

Owner action needed: identify a separate company-controlled test business/integration, confirm it is not the resident-wallet integration, and use the existing hidden-input inject-test-key.py script. Supply only non-secret business/integration identification in chat. After identity verification, mount the dedicated test key into the isolated receiver and bind ONLY that integration's TEST webhook to the current endpoint. Never edit production or wallet webhook settings. Account creation/ownership verification cannot be inferred from a key prefix. Do not send screenshots containing keys.

## Runner review and bounded plan
runner-review.cjs --review validates run-manifest.json and emits its SHA256 plus evidence classes. Any execution invocation is refused.39 review tests PASS, including caps, duplicate-intent amount conflicts, stopped-run behavior, unsupported modes/currency and unreviewed scenarios. These are local review controls; a real executor/transport is not armed.

Proposed limits requiring later explicit approval:12 test payment initializations, at most10000 kobo each and120000 kobo total (NGN1200 nominal test value),3 full-refund initializations at most10000 kobo each,60 provider reads,3 webhook replays,60 minutes. No unattended automatic retries of uncertain initialization/refund POSTs. Existing PostgreSQL payment/refund intent and history remain authoritative; the in-memory review Budget is NOT a substitute for those durable ledgers.

Scenarios: successful/declined payments; delayed success with injected network fault; controlled replay of a real webhook; redirect without verification; amount/reference mismatches using a separate injected verification fault; actual reservation expiry plus real payment; injected Office outage and retry; verified refund completion if supported; failed/needs-attention refunds if supported. Each manifest entry labels real-provider evidence versus injected faults. Unsupported provider scenarios remain BLOCKED or require an explicit disposition; no simulated response becomes a real-provider PASS.

Before execution: require exact integration ID, test-domain evidence, approved fixture prices/stock/delivery, independently approved refunds, current callback/webhook URLs, reviewed manifest hash, fresh isolation/schema gates and explicit user transaction authorization. Stop on any domain/amount/reference/order mismatch, unexpected destination, missing immutable audit, cap, ambiguous outcome or authentication/security failure. Preserve evidence and reconcile the original reference; do not generate a second charge/refund to hide an error.

After stopping: disable new initialization/refund initiation first; preserve ledgers and pending provider evidence. Do not assert bank arrival from refund processed status. If outcomes remain pending, request separately bounded follow-up verification; do not silently exceed time/read limits. Cleanup refuses when financial records exist or cannot be inspected, before stopping the webhook.

## Authorization evidence
Office11db9c6 keeps commerce.payment.operations in the actual config parser and exact-route allowlist. Config-parser test plus8 HTTP checks/7 scope assertions PASS; original48 isolation checks PASS again. Financial-operations key reads only its approved-refund queue/accepts bounded observations; it receives403 on payment confirmation. Checkout keys/guest/session cannot substitute for dedicated confirmation scope. Backend setup has no Office confirmation key mounted, and initialization/reconciliation remain503. Original verified provider evidence and transactional Office confirmation remain the only paid/allocation path. Current payment/refund ledgers remain empty.

Secure-key checks5 PASS; startup/callback checks21 PASS; existing payment validation18, wallet-boundary HTTP9 and signed webhook HTTP6 PASS. No production grants or account changes.

## Five High findings remain open
|Package|Path and disposition|
|---|---|
|ip|node-ssdp → ip1.1.9; unsafe isPublic classification. No patched compatible release identified; replace discovery dependency with dedicated multicast/interface tests.|
|node-ssdp|Inherited High from ip, not a second independent CVE. Do not take npm's unsafe v1 downgrade.|
|ip-address|ip-cidr3 → ip-address7; several parsing/classification advisories. ip-cidr relies on JSBN APIs incompatible with a blind major override; upgrade/replace and test IPv4/IPv6 enumeration. MQTT/socks already uses patched10.7.5.|
|zod|3.25.76; upstream fix4.6.6+ requires record/error API migration and automation regressions. Existing record schemas alone do not prove the advisory's array-exhaustion exploit, but finding is not waived.|
|openai|Inherited Zod finding. Coordinate SDK/Zod compatibility; avoid unrelated blind major upgrade.|

Current audit remains0 Critical,5 High,1 Moderate,1 Low. None of the five High packages is loaded by the hardware-only entrypoint; all remain installed/open and block general production release absent remediation or explicit reviewed disposition. No dependency change was made in this preparation pass. Full paths/advisory links are in docs/commerce/provider-validation/DEPENDENCY-REVIEW.md.

## Reproduction and cleanup
start-egress.py builds and starts only the dedicated labelled relay; it refuses silent replacement. verify-egress.py performs the bounded read-only probe/denial checks; restart explicitly once its five-probe cap is exhausted. stop-egress.py removes only that relay and its NAT network. The environment's teardown.py now includes these resources and checks financial state before stopping the tunnel or deleting anything. It never changes host firewall rules: relay rules live inside its disposable network namespace.

Official references: https://paystack.com/docs/api/ and https://paystack.com/docs/payments/webhooks/ . Paystack test webhook retries may continue after non200 responses;503 during preparation intentionally does not acknowledge processing. No test event has been sent by a verified Paystack integration here.

## Verdicts
- Local preparation and isolation: PASS.
- Dedicated credential readiness: BLOCKED pending owner identity and secure injection.
- Webhook ingress: PASS; Paystack-side binding: UNVERIFIED.
- Actual provider test transactions/refunds: NO-GO, not authorized and not armed.
- Production release, live payments/public Hardware: NO-GO. Phase3 independent production approval/release/withdrawal prerequisite remains mandatory.
