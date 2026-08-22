import assert from "node:assert/strict";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "goal-runtime-smoke-service-role-key";

// Oyi Autonomous Work Runtime -- pure-logic smoke coverage (Part O).
// Same "no ConversationOrchestrator.js import in this process" rule as
// every other *-smoke.mjs in this suite (see communication-runtime-
// smoke.mjs's own header note) -- goalIntentParser.js/goalEvaluator.js/
// TelephonyAdapter.js are pure/DB-boundary-safe enough to import
// directly. Full DB-backed coverage (scheduler CAS-claim, event wake,
// idempotent dedup, live reply classification) is production-verified
// live against real Supabase/WhatsApp, the same discipline every prior
// Oyi programme in this repo used -- not reproducible against a local
// dummy Supabase URL, so it is NOT re-attempted here.
const {
  parseGoalCreationIntent,
  resolveGoalDeadline,
  parseGoalQueryIntent,
  parseGoalControlIntent,
  isGoalListQuery,
} = await import("../dist/oyi-core/interpretation/goalIntentParser.js");
const { TelephonyAdapter } = await import("../dist/services/communicationRuntime/adapters/TelephonyAdapter.js");
const { evaluateGoal } = await import("../dist/services/goalRuntime/goalEvaluator.js");

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.log(`FAIL ${label}\n  got:      ${a}\n  expected: ${e}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

// 1. Basic creation -- default single-channel repeating plan, reply_received success.
{
  const r = parseGoalCreationIntent("Follow up with David until he replies");
  check("1 basic until-reply", r && { recipientToken: r.recipientToken, successCondition: r.successCondition, stagedPlan: r.stagedPlan, escalateAtEnd: r.escalateAtEnd }, {
    recipientToken: "David",
    successCondition: { type: "reply_received" },
    stagedPlan: null,
    escalateAtEnd: false,
  });
}

// 2. Positive-reply success condition + explicit body + escalation fallback.
{
  const r = parseGoalCreationIntent(`Follow up with the Acme lead until they say yes, saying "just checking in on the proposal", otherwise escalate to me`);
  check("2 positive+saying+escalate", r && { recipientToken: r.recipientToken, successCondition: r.successCondition, messageBody: r.messageBody, escalateAtEnd: r.escalateAtEnd }, {
    recipientToken: "the Acme lead",
    successCondition: { type: "positive_reply" },
    messageBody: "just checking in on the proposal",
    escalateAtEnd: true,
  });
}

// 3. Explicit staged multi-channel plan with per-stage wait times.
{
  const r = parseGoalCreationIntent("Follow up with David: email now, then whatsapp in 2 days, then call in 2 more days");
  check("3 staged plan", r && { recipientToken: r.recipientToken, stagedPlan: r.stagedPlan }, {
    recipientToken: "David",
    stagedPlan: [
      { channel: "email", waitHours: 0 },
      { channel: "whatsapp", waitHours: 48 },
      { channel: "voice_call", waitHours: 48 },
    ],
  });
}

// 4. Explicit single channel without a staged plan.
check("4 explicit channel", parseGoalCreationIntent("Follow up with David by whatsapp until he replies")?.requestedChannel, "whatsapp");

// 5. Recurrence interval + relative deadline, and 6. deadline resolves to real ISO math.
{
  const r = parseGoalCreationIntent("Follow up with David every 3 days until he replies, within 2 weeks");
  check("5 recurrence+deadline hint", r && { recurrenceHours: r.recurrenceHours, deadlineHint: r.deadlineHint }, { recurrenceHours: 72, deadlineHint: "within 2 weeks" });
  const deadline = resolveGoalDeadline(r.deadlineHint, new Date("2026-08-22T00:00:00Z"));
  check("6 resolved relative deadline", deadline, new Date(new Date("2026-08-22T00:00:00Z").getTime() + 14 * 24 * 3600_000).toISOString());
}

// 7. Weekday deadline resolves to the NEXT occurrence, not today even if today matches.
{
  const d = resolveGoalDeadline("by friday", new Date("2026-08-22T10:00:00Z")); // a Saturday
  check("7 weekday deadline lands on the right date", d && d.startsWith("2026-08-28"), true);
}

// 8-9. Non-goal phrases never misfire (including an ordinary send request).
check("8 non-match ordinary question", parseGoalCreationIntent("What's the weather like?"), null);
check("9 non-match ordinary send", parseGoalCreationIntent("Email David saying hello"), null);

// 10-14. Status query phrasing variants.
check("10 query status-of", parseGoalQueryIntent("What's the status of the follow-up with David?"), { recipientToken: "David" });
check("11 query how's-going", parseGoalQueryIntent("How's the follow-up with David going?"), { recipientToken: "David" });
check("12 query any-update", parseGoalQueryIntent("Any update on David?"), { recipientToken: "David" });
check("13 query is-done", parseGoalQueryIntent("Is the follow-up with David done?"), { recipientToken: "David" });
check("14 query no-token falls back to continuity", parseGoalQueryIntent("What's the status of the goal?"), { recipientToken: null });
check("15 query non-match", parseGoalQueryIntent("What's the weather?"), null);

// 16. List-all query, distinct from a single-goal query.
check("16 list query", isGoalListQuery("Show me my active follow-ups"), true);
check("17 list query non-match", isGoalListQuery("Show me my active follow-up with David"), false);

// 18-24. Safety controls (Part N) -- must resolve unambiguously and immediately.
check("18 control pause", parseGoalControlIntent("Pause that"), { kind: "pause", recipientToken: null });
check("19 control pause-with", parseGoalControlIntent("Pause the follow-up with David"), { kind: "pause", recipientToken: "David" });
check("20 control resume", parseGoalControlIntent("Resume the follow-up"), { kind: "resume", recipientToken: null });
check("21 control cancel stop-following", parseGoalControlIntent("Stop following up with David"), { kind: "cancel", recipientToken: "David" });
check("22 control cancel stop-contacting", parseGoalControlIntent("Stop contacting him"), { kind: "cancel", recipientToken: "him" });
check("23 control dont-call-again narrows channel, not a full cancel", parseGoalControlIntent("Don't call him again"), { kind: "block_channel", channel: "voice_call", recipientToken: null });
check("24 control only-email restricts channel", parseGoalControlIntent("Only email him from now on"), { kind: "restrict_to_channel", channel: "email", recipientToken: null });

// 25. Telephony -- never fabricates a call; honest not_configured failure.
{
  const adapter = new TelephonyAdapter();
  check("25 telephony not configured", adapter.isConfigured(), false);
  const result = await adapter.send({ recipient: { phone: "+15551234567" } });
  check("25 telephony honest failure", { status: result.status, failure_reason: result.failure_reason }, { status: "failed", failure_reason: "not_configured" });
}

// 26. evaluateGoal's deadline hard-stop fires WITHOUT any DB access (a
// dummy unreachable SUPABASE_URL above would surface as a thrown/hung
// call if this branch ever touched the network -- it must return
// synchronously off the goal record alone).
{
  const goal = {
    id: "00000000-0000-0000-0000-000000000001",
    schedule: { deadline: new Date(Date.now() - 3600_000).toISOString(), recurrence: null, timezone: null },
    attempts_completed: 0,
    max_attempts: 5,
    linked_communication_threads: [],
    plan: [],
    current_step_index: 0,
    observations: [],
    evidence: [],
    execution_history: [],
    success_condition: { type: "reply_received" },
    stop_condition: { type: "none" },
    target_entities: {},
  };
  const evaluated = await evaluateGoal(goal);
  check("26 deadline hard stop", evaluated.status, "expired");
}

// 27. evaluateGoal's max-attempts hard-stop fires the same way -- also
// no DB access needed, a genuine safety bound even if a plan were
// somehow malformed to run forever.
{
  const goal = {
    id: "00000000-0000-0000-0000-000000000002",
    schedule: { deadline: null, recurrence: null, timezone: null },
    attempts_completed: 5,
    max_attempts: 5,
    linked_communication_threads: [],
    plan: [],
    current_step_index: 0,
    observations: [],
    evidence: [],
    execution_history: [],
    success_condition: { type: "reply_received" },
    stop_condition: { type: "none" },
    target_entities: {},
  };
  const evaluated = await evaluateGoal(goal);
  check("27 max attempts hard stop", evaluated.status, "blocked");
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL 27 PASSED");
process.exit(failures ? 1 : 0);
