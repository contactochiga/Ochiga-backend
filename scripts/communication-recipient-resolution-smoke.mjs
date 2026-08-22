import assert from "node:assert/strict";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "communication-recipient-resolution-smoke-service-role-key";

// Oyi generic recipient/person resolution + expanded communication NL --
// pure-logic checks only (no ConversationOrchestrator.js import in this
// process, same discipline as the other communication-runtime smoke
// scripts).
const {
  parseCommunicationSendIntent,
  parseChannelReuseIntent,
  parseCommunicationRevisionIntent,
  parsePersonLookupIntent,
  isPersonLookupToken,
  isPronounToken,
} = await import("../dist/oyi-core/interpretation/communicationIntentParser.js");
const { matchDisambiguationReply } = await import("../dist/oyi-core/context/personContext.js");

// ============================= Expanded verb coverage =============================
assert.deepEqual(parseCommunicationSendIntent("mail this to Daniel that the drawings are ready"), {
  channel: "email",
  recipientToken: "this to Daniel",
  body: "the drawings are ready",
});
assert.deepEqual(parseCommunicationSendIntent("forward this to the client saying please review"), {
  channel: "auto",
  recipientToken: "this to the client",
  body: "please review",
});
assert.deepEqual(parseCommunicationSendIntent("text her saying call me back"), {
  channel: "sms",
  recipientToken: "her",
  body: "call me back",
});

// ============================= Voice call parsing (no provider yet, but must still parse) =============================
assert.deepEqual(parseCommunicationSendIntent("call him tomorrow afternoon"), {
  channel: "voice_call",
  recipientToken: "him",
  body: "tomorrow afternoon",
});
assert.deepEqual(parseCommunicationSendIntent("ring the client"), {
  channel: "voice_call",
  recipientToken: "the client",
  body: "(voice call -- no message body)",
});
assert.deepEqual(parseCommunicationSendIntent("give her a call"), {
  channel: "voice_call",
  recipientToken: "her",
  body: "(voice call -- no message body)",
});

// ============================= Question vs action differentiation =============================
assert.equal(parseCommunicationSendIntent("Can we email this lead?"), null, "a capability question must never be read as an action");
assert.equal(parseCommunicationSendIntent("what's his email?"), null);

// ============================= Channel/content reuse =============================
assert.deepEqual(parseChannelReuseIntent("Send it on WhatsApp too."), { channel: "whatsapp", recipientToken: null });
assert.deepEqual(parseChannelReuseIntent("Send that on email as well."), { channel: "email", recipientToken: null });
assert.deepEqual(parseChannelReuseIntent("Send the same to Ada."), { channel: "auto", recipientToken: "Ada" });
assert.deepEqual(parseChannelReuseIntent("Do the same for the other contact."), { channel: "auto", recipientToken: "the other contact" });
assert.equal(parseChannelReuseIntent("Email idoko@ochiga.com.ng saying hi"), null, "a fresh, fully-specified send must not be misread as a reuse request");

// ============================= Revision-before-send =============================
assert.deepEqual(parseCommunicationRevisionIntent("Actually add that the meeting is Thursday."), { additionalText: "the meeting is Thursday." });
assert.deepEqual(parseCommunicationRevisionIntent("Also mention we received the drawings."), { additionalText: "we received the drawings." });
assert.equal(parseCommunicationRevisionIntent("yes"), null);

// ============================= Person lookup intent =============================
assert.deepEqual(parsePersonLookupIntent("Open the Daniel lead."), { query: "Daniel", queryType: "auto" });
assert.deepEqual(parsePersonLookupIntent("Who is David Okoro?"), { query: "David Okoro", queryType: "auto" });
assert.equal(parsePersonLookupIntent("Who is this?"), null, "a pronoun question resolves from active context, not a fresh directory search");
assert.equal(parsePersonLookupIntent("who is handling this partnership?"), null);

// ============================= Token classification =============================
assert.equal(isPronounToken("him"), true);
assert.equal(isPronounToken("her"), true);
assert.equal(isPronounToken("Daniel"), false);
assert.equal(isPersonLookupToken("Daniel"), true, "a bare name needs directory lookup");
assert.equal(isPersonLookupToken("him"), true, "a pronoun also routes through the lookup path (via continuity, not a fresh search)");
assert.equal(isPersonLookupToken("me"), false, "already resolvable from the token itself");
assert.equal(isPersonLookupToken("idoko@ochiga.com.ng"), false, "already resolvable from the token itself");
assert.equal(isPersonLookupToken("+2348100373353"), false, "already resolvable from the token itself");
// Regression -- found via live testing: "Has HE replied?" ("he", not
// "him") was misclassified as a fresh-directory-search name instead of
// a pronoun, causing an ilike substring search that matched unrelated
// records purely by coincidence (e.g. "he" inside "Check").
assert.equal(isPronounToken("he"), true);
assert.equal(isPronounToken("she"), true);
assert.equal(isPronounToken("they"), true);

// ============================= Disambiguation reply matching =============================
const candidates = [
  { display_name: "David Okoro", organisation_name: "ABC Ltd" },
  { display_name: "David Musa", organisation_name: "XYZ Ltd" },
];
assert.equal(matchDisambiguationReply("David Okoro at ABC Ltd", candidates).display_name, "David Okoro");
assert.equal(matchDisambiguationReply("the one at XYZ Ltd", candidates).display_name, "David Musa");
assert.equal(matchDisambiguationReply("the first one", candidates).display_name, "David Okoro");
assert.equal(matchDisambiguationReply("the second one", candidates).display_name, "David Musa");
assert.equal(matchDisambiguationReply("someone else entirely", candidates), null, "an unrelated reply must never guess a candidate");

console.log("communication-recipient-resolution-smoke: PASS");
