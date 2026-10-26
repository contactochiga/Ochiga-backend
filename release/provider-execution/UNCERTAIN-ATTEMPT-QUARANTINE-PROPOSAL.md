# Uncertain Paystack initialization — quarantine proposal

**Status: proposal only; not applied.** Do not resume financial execution or alter production. This document does not change payment, order, reservation, execution-ledger, budget, or dispatch-ticket records.

## Attempt identity and evidence

- Isolated run: `fb70bddcdadf`.
- Original synthetic payment reference: retained in the isolated Backend payment attempt and execution ledger. The release report uses only the redacted form `hwo_c583…e435`; do not replace or reissue it.
- Paystack Test Mode result: **unavailable / not established**. The read-only verification attempt produced no usable provider response. This does not establish that Paystack has no matching transaction or rejected it.
- Backend attempt: `uncertain`, NGN 10,000 kobo, no provider transaction ID, no hosted checkout URL; three recorded attempts/claims.
- Office order: payment `not_started`; no payment confirmation and no stock allocation.
- Reservation: state remains `held`; its expiry timestamp has passed, while `ended_at` is unset. This is a stale expiry state to review separately. No expiry transition or inventory adjustment was performed.
- Execution ledger: integrity check `ok`; run disabled and not stopped; one payment intent remains `uncertain`; two read intents returned; all three dispatch tickets are consumed.
- Refund records/initiations: none.

## Proposed quarantine controls

1. Keep the original Backend attempt, Office order, reservation, execution ledger, immutable events, and consumed dispatch tickets intact.
2. Keep all initialization, processing, reconciliation execution, and refund execution switches disabled. Do not call initialization again, mint another reference, reset the run budget, or recreate dispatch tickets.
3. Treat the attempt as quarantined operationally only. The existing non-`created` Backend attempt does not initialize again; later reconciliation, if separately authorized, must verify only the original reference and require authoritative provider evidence.
4. Do not confirm payment or refund, allocate inventory, or infer rejection from a missing response. Provider evidence must bind the exact original reference, amount, currency, environment, and order metadata.
5. Review the reservation expiry through its existing Office workflow separately. Any release of held stock must not change payment status or imply a payment outcome.
6. Preserve this report alongside the original immutable ledger evidence. Do not write a synthetic “failed” or “not found” provider event.

## Conditions before any new bounded run

- Obtain authoritative Paystack Test Mode evidence for the original reference through a successful read-only verification or the authorized dashboard. Record only the provider-confirmed result. If it remains unavailable, retain this quarantine and keep the run NO-GO.
- Have a reviewer approve any quarantine/final disposition; this proposal itself applies no disposition.
- Resolve or explicitly disposition the expired-but-held reservation without conflating it with payment resolution.
- Perform a fresh isolation and budget preflight on a separate, clean run only after the original attempt is reconciled or formally dispositioned.
- Obtain separate authorization before any new provider transaction. This proposal grants none.
