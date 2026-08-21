import assert from "node:assert/strict";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "milestone2-documents-content-readonly-smoke-service-role-key";

// Oyi Office Conversational Runtime, Milestone 2 — Documents/Content
// list capabilities. Explicitly, permanently READ-ONLY: no drafting,
// generation, publishing, or approval action is added anywhere in this
// milestone (see officeDocumentsReadModule's/officeContentReadModule's
// own header notes) -- this smoke proves both the new list capability
// works AND that no write capability exists for either domain.
const { buildOfficeInternalReadCapabilities } = await import("../dist/oyi-core/capabilities/OfficeCorporateCapabilityModules.js");
const { buildOfficeActionCapabilities } = await import("../dist/oyi-core/capabilities/OfficeActionCapabilityModules.js");

const readModules = buildOfficeInternalReadCapabilities();
const actionModules = buildOfficeActionCapabilities();
function readModule(key) {
  const found = readModules.find((m) => m.key === key);
  assert.ok(found, `${key} must be registered`);
  return found;
}
function frame(domain, normalizedText) {
  return { domain, normalizedText };
}
function contextWithSnapshot(message, section, value) {
  return { input: { message, context: { operational_snapshot: { [section]: value } } } };
}

// --- No write capability exists for either domain, by construction ---
assert.ok(!actionModules.some((m) => m.domain === "office_documents"), "Documents must never gain a write capability");
assert.ok(!actionModules.some((m) => m.domain === "office_content"), "Content must never gain a write capability");

// ============================= Documents ================================
{
  const list = readModule("office_documents.query.read");
  const single = readModule("office_documents.read");
  assert.equal(list.supports(frame("office_documents", "show me the documents")), true);
  assert.equal(single.supports(frame("office_documents", "show me the documents")), false, "single-record module must not also claim a list query");
  assert.equal(list.supports(frame("office_documents", "what type is this document")), false, "singular question must not be claimed by the list module");
  assert.equal(single.supports(frame("office_documents", "what type is this document")), true);
  // A read-only domain must never claim a mutation-shaped message either.
  assert.equal(list.supports(frame("office_documents", "draft a new document")), false);

  const documents = {
    items: [
      { id: "doc-1", title: "Greenview MSA", document_type: "contract", status: "signed", owner: "Ada" },
      { id: "doc-2", title: "Havana proposal", document_type: "proposal", status: "draft", owner: "Tony" },
    ],
    total: 2,
  };
  const ctx = contextWithSnapshot("show me the documents", "documents", documents);
  const evidence = await list.collectEvidence(ctx);
  assert.equal(evidence.length, 2);
  const answer = await list.buildReadResponse(ctx, evidence);
  assert.equal(answer.status, "answered");
  assert.ok(answer.answer.includes("Greenview MSA"));
  assert.ok(answer.answer.includes("Havana proposal"));
  assert.equal(answer.blocks[0].type, "record_list");
}

// ============================== Content ==================================
{
  const list = readModule("office_content.query.read");
  const single = readModule("office_content.read");
  assert.equal(list.supports(frame("office_content", "show me the articles")), true);
  assert.equal(single.supports(frame("office_content", "show me the articles")), false);
  assert.equal(list.supports(frame("office_content", "what category is this")), false);
  assert.equal(single.supports(frame("office_content", "what category is this")), true);
  assert.equal(list.supports(frame("office_content", "publish this article")), false);

  const content = {
    items: [{ id: "c-1", title: "Ochiga launches Facility OS", workflow_status: "review", category: "product" }],
    total: 1,
  };
  const ctx = contextWithSnapshot("show me the articles", "content", content);
  const evidence = await list.collectEvidence(ctx);
  assert.equal(evidence.length, 1);
  const answer = await list.buildReadResponse(ctx, evidence);
  assert.ok(answer.answer.includes("Ochiga launches Facility OS"));
}

// ==================== Absent-snapshot honesty ====================
{
  const list = readModule("office_documents.query.read");
  const emptyCtx = { input: { message: "show me the documents", context: {} } };
  const answer = await list.buildReadResponse(emptyCtx, []);
  assert.equal(answer.status, "unavailable");
}

console.log("milestone2-documents-content-readonly-smoke: PASS");
