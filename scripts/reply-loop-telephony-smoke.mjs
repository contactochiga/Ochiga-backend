import assert from "node:assert/strict";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "reply-loop-telephony-smoke-service-role-key";

// Oyi Communication Runtime -- Live Reply Loop + Telephony programme.
// Pure-logic smoke coverage (Program I). Same "no ConversationOrchestrator.js
// import in this process" rule as every other *-smoke.mjs (see
// communication-runtime-smoke.mjs's header note). Full DB-backed
// coverage (atomic idempotency under real concurrency, opt-out
// enforcement against a live send, goal wake from a real webhook) is
// production-verified live -- not reproducible against a dummy Supabase
// URL, so it is NOT re-attempted here.
const { quickUnsubscribeCheck } = await import("../dist/services/communicationRuntime/replyClassifier.js");
const { verifyTwilioSignature, TwilioVoiceAdapter } = await import("../dist/services/communicationRuntime/adapters/TwilioVoiceAdapter.js");
const { TelephonyAdapter } = await import("../dist/services/communicationRuntime/adapters/TelephonyAdapter.js");
const { parseCallStatusQuery, isCallsTodayQuery } = await import("../dist/oyi-core/interpretation/communicationIntentParser.js");
const { parseGoalControlIntent } = await import("../dist/oyi-core/interpretation/goalIntentParser.js");

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

// 1-6. Unsubscribe/STOP detection -- must fire without depending on the
// OpenAI classifier being reachable (governance cannot depend on a
// third-party API being up).
check("1 stop bare word", quickUnsubscribeCheck("STOP"), true);
check("2 unsubscribe phrase", quickUnsubscribeCheck("please unsubscribe"), true);
check("3 dont contact me", quickUnsubscribeCheck("don't contact me again"), true);
check("4 opt out spaced", quickUnsubscribeCheck("opt out"), true);
check("5 leave me alone", quickUnsubscribeCheck("leave me alone"), true);
check("6 not a stop phrase", quickUnsubscribeCheck("I stopped by your office yesterday"), false);
check("7 ordinary reply", quickUnsubscribeCheck("Sounds good, let's talk tomorrow"), false);
check("8 empty", quickUnsubscribeCheck(""), false);

// 9-12. Twilio request-signature verification. Twilio's documented
// algorithm (RequestValidator): sort POST params alphabetically by key,
// append each key+value directly to the full URL, HMAC-SHA1 with the
// auth token, base64-encode. The expected signature below is computed
// independently via node's own crypto module (ground truth), not a
// memorized magic string, so this is a genuine correctness check of
// verifyTwilioSignature() against the documented algorithm rather than
// a self-fulfilling assertion.
{
  const crypto = await import("node:crypto");
  const authToken = "test-auth-token-12345";
  const url = "https://oyi-os.onrender.com/webhooks/twilio/status-callback?communication_id=abc-123";
  const params = { CallSid: "CA1234567890ABCDE1234567890ABCDEF", CallStatus: "completed", CallDuration: "42", From: "+14158675310", To: "+18005551212" };
  const sortedKeys = Object.keys(params).sort();
  const data = sortedKeys.reduce((acc, key) => acc + key + params[key], url);
  const validSig = crypto.createHmac("sha1", authToken).update(data, "utf8").digest("base64");

  check("9 independently-computed valid signature accepted", verifyTwilioSignature(authToken, url, params, validSig), true);
  check("10 tampered signature rejected", verifyTwilioSignature(authToken, url, params, "dGFtcGVyZWRzaWduYXR1cmU="), false);
  check("11 missing signature rejected", verifyTwilioSignature(authToken, url, params, undefined), false);
  check("12 wrong auth token rejected", verifyTwilioSignature("a-different-token", url, params, validSig), false);
}

// 13-14. Telephony adapter selection is genuinely unconfigured in this
// environment -- never fabricates readiness.
{
  const twilio = new TwilioVoiceAdapter();
  check("13 twilio honestly unconfigured (no credentials in this env)", twilio.isConfigured(), false);
  const generic = new TelephonyAdapter();
  check("14 generic telephony adapter also honestly unconfigured", generic.isConfigured(), false);
}

// 15-16. E.164 validation via adapter.validate().
{
  const twilio = new TwilioVoiceAdapter();
  check("15 valid E.164 recipient passes validation", twilio.validate({ recipient: { phone: "+2348100373353" } }).valid, true);
  check("16 malformed phone fails validation", twilio.validate({ recipient: { phone: "08100373353" } }).valid, false);
}

// 17-19. Status-callback normalization -- known Twilio CallStatus values
// map to the canonical call-lifecycle vocabulary.
{
  const twilio = new TwilioVoiceAdapter();
  const completed = twilio.normalizeWebhook({ CallSid: "CA123", CallStatus: "completed", CallDuration: "42" });
  check("17 completed maps to call.completed", completed[0]?.type, "call.completed");
  check("17b duration parsed", completed[0]?.metadata?.duration_seconds, 42);
  const noAnswer = twilio.normalizeWebhook({ CallSid: "CA124", CallStatus: "no-answer" });
  check("18 no-answer maps to call.failed with outcome no_answer", { type: noAnswer[0]?.type, outcome: noAnswer[0]?.metadata?.outcome }, { type: "call.failed", outcome: "no_answer" });
  const empty = twilio.normalizeWebhook({});
  check("19 malformed payload normalizes to empty, never guessed", empty, []);
}

// 20-24. Call-specific natural-language queries (Programme G) -- distinct
// from the WhatsApp reply-query grammar.
check("20 did the call go through", parseCallStatusQuery("Did the call go through?"), "went_through");
check("21 did he answer", parseCallStatusQuery("Did he answer?"), "answered");
check("22 how long did we speak", parseCallStatusQuery("How long did we speak?"), "duration");
check("23 non-call question", parseCallStatusQuery("What's the weather?"), null);
check("24 calls made today", isCallsTodayQuery("Show me the calls made today"), true);

// 25-26. "Stop calling" narrows the channel with a captured recipient,
// distinct from a full "stop contacting" cancel.
check("25 stop calling named recipient", parseGoalControlIntent("Stop calling David"), { kind: "block_channel", channel: "voice_call", recipientToken: "David" });
check("26 dont call again captures pronoun", parseGoalControlIntent("Don't call him again"), { kind: "block_channel", channel: "voice_call", recipientToken: "him" });

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
