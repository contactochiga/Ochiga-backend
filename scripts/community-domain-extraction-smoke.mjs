import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "dummy-service-role-key";

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const runtimeSource = read("src/oyi-core/runtime/canonicalConversationRuntime.ts");
const persistenceSource = read("src/oyi-core/persistence/canonicalConversationPersistence.ts");
const communityAnswers = read("src/oyi-core/domains/community/communityConversationAnswers.ts");
const communityEvidence = read("src/oyi-core/domains/community/communityEvidence.ts");
const targetCandidates = read("src/oyi-core/context/conversationTargetCandidates.ts");
const hydrationRegistry = read("src/oyi-core/runtime/canonicalTargetHydrationRegistry.ts");
const domainRegistry = read("src/oyi-core/runtime/domainCapabilityRegistry.ts");
const messagesController = read("src/controllers/messagesController.ts");
const runtime = await import(path.join(root, "dist/oyi-core/testing/canonicalConversationTestSupport.js"));

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const staleDevice = {
  object_type: "device",
  canonical_id: "device-living-room-light",
  label: "Living Room Light",
  estate_id: "estate-1",
  home_id: "home-1",
  room_id: "living-room",
  source_module: "devices",
  capabilities: ["power"],
  current_state: "on",
  health: "healthy",
  permissions: ["devices.read"],
  relationships: {},
  evidence_references: [],
  metadata: {},
  freshness: "fresh",
};

const messageThread = {
  object_type: "message_thread",
  canonical_id: "dm-thread-1",
  label: "Facility message thread",
  estate_id: "estate-1",
  building_id: "building-1",
  home_id: "home-1",
  room_id: null,
  parent_id: null,
  source_module: "messages",
  capabilities: ["messages.read", "messages.reply"],
  current_state: "unread",
  health: "open",
  permissions: ["messages.read"],
  relationships: {
    messages: [
      { id: "msg-1", sender_name: "Facility", preview: "Please confirm access tomorrow.", unread: true, thread_type: "direct" },
    ],
  },
  evidence_references: [],
  metadata: { message_thread_id: "dm-thread-1" },
  freshness: "fresh",
};

const communityPost = {
  object_type: "community_post",
  canonical_id: "post-1",
  label: "Water outage announcement",
  estate_id: "estate-1",
  building_id: "building-1",
  home_id: null,
  room_id: null,
  parent_id: null,
  source_module: "community",
  capabilities: ["community.read"],
  current_state: "published",
  health: "active",
  permissions: ["community.read"],
  relationships: {
    announcements: [
      { id: "post-1", title: "Water outage", preview: "Water will be off at 2pm.", visibility: "announcement" },
    ],
  },
  evidence_references: [],
  metadata: { community_post_id: "post-1" },
  freshness: "fresh",
};

check("community domain owns message/community object behavior and evidence normalization", () => {
  assert.match(communityAnswers, /communityObjectProfile/);
  assert.match(communityAnswers, /communityObjectVoice/);
  assert.match(communityAnswers, /communityRecommendation/);
  assert.match(communityAnswers, /communityConfirmationReply/);
  assert.match(communityAnswers, /communityContextualActions/);
  assert.match(communityAnswers, /buildCommunityReadAnswer/);
  assert.match(communityEvidence, /communityRecordsFromContext/);
  assert.match(communityEvidence, /communityThreadBoundarySummary/);
  assert.match(communityEvidence, /community_message_threads_are_operational_targets_not_oyi_conversation_threads/);
  assert.doesNotMatch(runtimeSource, /I track this conversation thread, participants, messages, and operational follow-up/);
  assert.doesNotMatch(runtimeSource, /I track this community item, audience, responses, and follow-up state/);
});

check("community and message targets use shared candidate and hydration contracts", () => {
  assert.match(targetCandidates, /object_type: "message_thread"/);
  assert.match(targetCandidates, /message_thread_id/);
  assert.doesNotMatch(targetCandidates, /conversation_id \|\| contextRecord\.thread_id \|\| contextRecord\.threadId \|\| contextRecord\.message_thread_id/);
  assert.match(hydrationRegistry, /community_post: \{ table: "community_posts"/);
  assert.match(hydrationRegistry, /message_thread: \{ table: "dm_threads"/);
  assert.match(runtimeSource, /resolveConversationTarget/);
  assert.match(runtimeSource, /hydrateOperationalObjectCandidate/);
});

check("Oyi conversation threads remain distinct from Community message threads", () => {
  assert.equal(runtime.isConversationContainerObject({ object_type: "conversation_thread", canonical_id: "oyi-thread-1" }), true);
  assert.equal(runtime.isConversationContainerObject({ object_type: "message_thread", canonical_id: "thread-1" }), true);
  assert.equal(runtime.isConversationContainerObject({ object_type: "message_thread", canonical_id: "dm-thread-1", source_module: "messages", message_thread_id: "dm-thread-1" }), false);
  assert.match(persistenceSource, /oyi_conversation_messages/);
  assert.doesNotMatch(runtimeSource, /oyi_conversation_messages/);
  assert.match(communityEvidence, /dm_threads/);
  assert.match(communityEvidence, /dm_messages/);
  assert.match(communityEvidence, /community_posts/);
});

check("consumer message and community reads reject stale device inheritance and remain read-only", () => {
  for (const message of ["Do I have any unread messages?", "Tell me what Facility said.", "What did the building announce today?"]) {
    const result = runtime.canonicalResolvedTurnForTest({
      message,
      object: staleDevice,
      surface: "consumer",
      request: { estate_id: "estate-1", home_id: "home-1" },
    });
    assert.match(String(result.resolved_turn.domain), /^(messages|community)$/);
    assert.equal(result.contract.intent, "domain_list");
    assert.equal(result.contract.operation_class, "list");
    assert.equal(result.contract.mutation.requested, false);
    assert.notEqual(result.contract.target.object_type, "device");
    assert.equal(runtime.canonicalInheritedTargetEligibilityForTest({ message, object: staleDevice }), false);
  }
});

check("facility community reads use the same Oyi Core path without private-message expansion", () => {
  const result = runtime.canonicalResolvedTurnForTest({
    message: "Show community announcements.",
    object: null,
    surface: "facility",
    request: { estate_id: "estate-1", building_id: "building-1" },
  });
  assert.equal(result.resolved_turn.domain, "community");
  assert.equal(result.contract.intent, "domain_list");
  assert.equal(result.resolved_turn.authority.allowed, true);
  assert.match(messagesController, /assertActiveHomeMembership/);
  assert.match(messagesController, /assertThreadInActiveScope/);
  assert.match(messagesController, /moderation/i);
});

check("send, reply and post requests become governed compose work rather than execution", () => {
  for (const [message, expectedDomain, expectedIntent] of [
    ["Reply that I will be available tomorrow.", "messages", "message_operation"],
    ["Send a message to Facility.", "messages", "message_operation"],
    ["Post this to the community.", "community", "community_operation"],
    ["Tell the residents the water will be off at 2pm.", "community", "community_operation"],
  ]) {
    const result = runtime.canonicalResolvedTurnForTest({
      message,
      object: expectedDomain === "messages" ? messageThread : communityPost,
      surface: "consumer",
      request: { estate_id: "estate-1", home_id: "home-1" },
    });
    assert.equal(result.resolved_turn.domain, expectedDomain, message);
    assert.equal(result.contract.intent, expectedIntent, message);
    assert.equal(result.contract.operation_class, "compose", message);
    assert.equal(result.contract.mutation.requested, false, message);
    assert.equal(result.presentation_policy.primary, "review", message);
  }
  assert.doesNotMatch(runtimeSource, /sendCommunityMessage|publishCommunityPost|dispatchMessage/i);
});

check("legitimate message-thread continuation works while broad community reads clear exact target", () => {
  const followUp = runtime.canonicalResolvedTurnForTest({
    message: "Reply that I've seen it.",
    object: messageThread,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.equal(followUp.resolved_turn.domain, "messages");
  assert.equal(followUp.contract.scope_mode, "exact_target");
  assert.equal(followUp.contract.target.object_type, "message_thread");
  assert.equal(runtime.canonicalInheritedTargetEligibilityForTest({ message: "Reply that I've seen it.", object: messageThread }), true);

  const broad = runtime.canonicalResolvedTurnForTest({
    message: "What else did the building announce today?",
    object: messageThread,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.equal(broad.resolved_turn.domain, "community");
  assert.equal(broad.contract.intent, "domain_list");
  assert.notEqual(broad.contract.target.object_type, "message_thread");
});

check("notifications remain a separate domain and delivery concern", () => {
  const notification = runtime.canonicalResolvedTurnForTest({
    message: "Show notifications.",
    object: communityPost,
    surface: "consumer",
    request: { estate_id: "estate-1", home_id: "home-1" },
  });
  assert.equal(notification.resolved_turn.domain, "notifications");
  assert.equal(notification.contract.intent, "domain_list");
  assert.match(domainRegistry, /domain: "notifications"/);
  assert.match(hydrationRegistry, /notification: \{ table: "notifications"/);
});

console.log("community-domain-extraction-smoke passed");
