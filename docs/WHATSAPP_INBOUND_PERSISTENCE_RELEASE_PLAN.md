# Backend inbound persistence fix — controlled release plan

Branch `fix/whatsapp-inbound-persistence-conflict-target` on `contactochiga/Ochiga-backend`, based on production `main` @ `44afac3182a709de63642359a783709ae6a0f435` (clean fast-forward). **Not deployed. No historical message has been replayed.** Backend `main` auto-deploys on Render (service Oyi-os); no database migration is required.

## Behaviour change to expect after deployment
From the first live inbound WhatsApp message after deployment, Backend will persist it (`oyi_communications`, direction inbound), classify it, apply opt-out governance, write the decision trail and wake any goal watching the thread (the designed behaviour that has not worked since 2026-08-23). Safety checks done: production currently has **no active/waiting goals** (oyi_goals: 2 cancelled, 1 blocked, 1 proposed — none can wake); Office refuses every autonomous/goal send while `whatsapp_autonomous_responses_enabled=false` (verified at the bridge), so even a future goal cannot message a customer while OFF; Office will now receive `goal_active=true` only when a goal is really watching the thread (existing single-responder rule). The classifier calls OpenAI per inbound message (existing behaviour, bounded latency); the Office forward timeout is 8 s and CRM intake does not depend on it.

## Deployment order (each production step needs explicit approval)
1. Preflight: Backend `main` still `44afac31…`; branch fast-forward; `npm run typecheck`, `npm run build`, `npm run smoke:whatsapp-inbound-persistence-postgres` and the communication smokes pass; Office autonomy `false`.
2. Fast-forward Backend `main` to the branch HEAD (no force). Render deploys. Verify `https://oyi-os.onrender.com/version` reports the new `commit_sha` and `/health` is ok.
3. Verify with ONE genuine inbound message from an approved test number: a new `oyi_communications` inbound row (aggregate query only), classification present, `inbound.classified` decision event, thread association; Office CRM still received it; no outbound message; autonomy OFF.
4. Watch for a day: inbound rows grow with Office's inbound events (counts only); no `inbound_event_persist_failed` in Backend logs.
**Rollback:** push a revert commit (fast-forward) restoring `44afac31…` behaviour (inbound persistence simply stops again; no data is harmed, rows created meanwhile stay and are idempotent if the fix is re-applied). No schema change to undo.

## Recovering historical Office inbound messages later (separate approval; not performed)
Why safe: a replay (`replay:true`) persists with the original timestamp and still honours opt-outs but cannot wake a goal, so no evaluation, follow-up or outbound message can follow; it is idempotent on the provider message id (messages already persisted — 5 of the 47 — are no-ops).
Scope measured today (ids only): Office holds **47 distinct inbound provider message ids**; Backend already has 5 of them; **42 are missing** (2026-08-22: 3, 08-24: 3, 09-09: 1, 10-02: 1, 10-10: 14, 10-12: 4, 10-13: 5, 10-14: 5, 10-15: 6 — the last six arrived while this work was under way).
Procedure (for a later, approved run): (a) deploy this fix first and verify live persistence; (b) dry run: read Office `inbound_events` (event_type `message`, lead_id, payload.id/from/text.body/timestamp), list the ids missing in Backend, print counts only; (c) send sequentially (one at a time, ≥1 s apart, 30 s timeout, resumable) `POST /office/communications/webhook-event` with `{channel:"whatsapp", provider_event_type:"message", provider_message_id, from, text, lead_id, occurred_at: <original timestamp>, replay:true}`, **ignoring the returned `goal_active`**; (d) verify aggregate counts (42 new inbound rows, zero outbound rows, zero `goal.wake_triggered`, opt-outs only for genuine historical STOP messages); (e) re-running is a no-op. Office needs no change for this beyond a small one-off script; historical Office data is read-only throughout. Customer content is never printed in reports.

## Exact approvals needed
1. Approve fast-forwarding Backend `main` to this branch (Step 2) — and, separately, Step 3's use of an approved test number.
2. Separately, later: approve the historical replay (Step "Recovering…") after live persistence is verified.
