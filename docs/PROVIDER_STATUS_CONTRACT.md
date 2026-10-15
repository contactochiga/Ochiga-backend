# Provider status contract — `GET /office/intelligence/providers`

Read-only projection of the **governed provider approval-record ledger** for Ochiga Office Settings S5. Implements `docs/settings-domain/11_BACKEND_PROVIDER_STATUS_CONTRACT_PROPOSAL.md` (Office branch `feature/settings-s1-s2`, commit `803d6b6`).

## Source of truth
`src/intelligence-core/providerStatus/approvalLedger.ts`: immutable, versioned (`ledger_version: 1`) records, each with `id`, `recorded_at`, `recorded_by` and `source` provenance (`type`, `ref`, optional `note`), and optional `supersedes`. A change is a **new record** made through code review; nothing in the runtime or the endpoint writes records. Kinds: `gateway_state`, `budget_authorization`, `observation`, `provider_state`.
Not sources: historical documentation, environment variables, the offline IQ-11F adapter registry, live provider calls. None of them proves current qualification, credentials, funding or data-processing approval. Seed records transcribe the dated IQ-11F checkpoints with their provenance; they assert what was approved or observed, not that anything is currently qualified.

## Projection rules (`projection.ts`, pure function)
- Every record is strictly validated and rebuilt from allowlisted fields; unknown providers, kinds, versions, bad dates, secret-shaped strings, duplicate ids and amounts without verified billing are **rejected** and reported (`rejected_records`, provenance), never projected.
- Superseded records are ignored. Latest record wins per field; records with the **same timestamp that disagree** make that value **unknown** and add a conflict note.
- Unknown stays unknown: no record for a provider → every field unknown plus "No approval record exists for this provider".
- Credentials: `verified` only from a **fresh** observation with `credentials: verified`; "not found in a checked scope" is `unknown`, never "not provisioned".
- Observations expire (`valid_for_hours`); a stale observation's facts revert to unknown and a stale note is listed first. `last_verified_at` still reports when it was recorded.
- Budget: `approved_maximum` (a ceiling only, from the latest provider-specific authorization), `verified_credits` and `verified_spend` (only from a fresh observation with verified billing) are three separate numbers. Remaining budget is **not** computed here (Office computes it from verified inputs).
- Conflicting records are preserved in `provenance[].conflicts`. Known case: the gateway approvals record (`authorized_spend_usd: 0`) vs the later OpenAI shadow authorization (`maximum_cumulative: 50`, synthetic, shadow-only, conditions unmet). Both are named; the provider-specific record supplies the OpenAI ceiling; Gemini and Anthropic show no ceiling.
- `activation` is always `{ contract_available: false, activated: false }`: this Backend defines no activation contract.

## Security
Behind `requireOfficeExportKey` (same boundary as the sibling intelligence routes). GET only. Exact response allowlists; defence-in-depth `scrubSecrets` over the whole response; internal errors never echo their message; `cache-control: no-store`. No provider API call, no live inference, no secret management, no billing reconciliation, no activation, no cross-provider fallback.

## Test
`npm run smoke:office-intelligence-providers` (builds first; Part 4 uses the Office repository named by `OFFICE_REPO`, default `/tmp/office-crm`).

## Approvals still required (not part of this slice)
A process for adding ledger records (who may, review rules); a credential/billing reconciliation job that produces verified observations; data-processing reviews; model selection; qualification runs; a Backend-owned activation contract; durable budget enforcement.
