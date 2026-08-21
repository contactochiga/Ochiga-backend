import assert from "node:assert/strict";
import { buildOfficeInternalResponse } from "../dist/oyi-core/policy/corporateOfficeInternalPolicy.js";

// Oyi Conversational Runtime Completion Programme, Phase 4, PR 1 — proves
// the adaptive-response-block passthrough plumbing: canonical.cards (already
// populated by capabilityDomainResultToConversationResponse from
// DomainResult.blocks, an existing Consumer/Facility-proven mechanism) now
// reaches office_internal's response as `blocks`, previously always
// discarded. No capability populates the new block types yet (that lands in
// PR 2+) -- this only proves the contract wiring itself.

const baseRequest = {
  request_id: "req-phase4-blocks-1",
  message: "Show me my open tasks.",
  office_session_id: "office-session-phase4-1",
  conversation_thread_id: "thread-phase4-blocks-1",
  staff: {
    staff_id: "staff-1",
    email: "staff@example.com",
    role: "ochiga_staff",
    permissions: ["office.read", "office.intelligence", "tasks.read"],
  },
  page_context: {
    page: "/office/tasks",
    selected_type: "task",
    selected_id: null,
  },
  business_unit: "corporate",
  capability_context: ["tasks"],
  crm_context: null,
  portfolio_context: null,
  support_context: null,
  requested_capability: "office_internal_conversation",
  knowledge_context: [],
  metadata: {},
};

const canonicalWithBlocks = {
  id: "canonical-phase4-blocks-1",
  thread_id: "thread-phase4-blocks-1",
  intent: "office_internal_conversation",
  message: "You have 3 open tasks.",
  persistence_saved: true,
  cards: [
    { type: "record_list", title: "Open Tasks", columns: [{ key: "title", label: "Title" }], rows: [{ id: "task-1", title: "Follow up with vendor" }] },
  ],
};

const responseWithBlocks = buildOfficeInternalResponse(baseRequest, canonicalWithBlocks);
assert.ok(Array.isArray(responseWithBlocks.blocks), "response.blocks must always be an array");
assert.equal(responseWithBlocks.blocks.length, 1, "response.blocks must carry canonical.cards through unchanged");
assert.equal(responseWithBlocks.blocks[0].type, "record_list");
assert.equal(responseWithBlocks.blocks[0].rows[0].id, "task-1");

const canonicalWithoutBlocks = {
  id: "canonical-phase4-blocks-2",
  thread_id: "thread-phase4-blocks-1",
  intent: "office_internal_conversation",
  message: "I can help with tasks, meetings, and support cases.",
  persistence_saved: true,
};

const responseWithoutBlocks = buildOfficeInternalResponse(baseRequest, canonicalWithoutBlocks);
assert.ok(Array.isArray(responseWithoutBlocks.blocks), "response.blocks must default to an array when canonical.cards is absent");
assert.equal(responseWithoutBlocks.blocks.length, 0);

const canonicalWithNonArrayCards = {
  id: "canonical-phase4-blocks-3",
  thread_id: "thread-phase4-blocks-1",
  intent: "office_internal_conversation",
  message: "Malformed upstream cards must not break the contract.",
  persistence_saved: true,
  cards: "not-an-array",
};

const responseWithNonArrayCards = buildOfficeInternalResponse(baseRequest, canonicalWithNonArrayCards);
assert.ok(Array.isArray(responseWithNonArrayCards.blocks), "response.blocks must defensively default to [] when canonical.cards is not an array");
assert.equal(responseWithNonArrayCards.blocks.length, 0);

console.log("phase4-adaptive-response-blocks-smoke: PASS");
