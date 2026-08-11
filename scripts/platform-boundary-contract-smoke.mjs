import assert from "node:assert/strict";
import {
  PLATFORM_BOUNDARY_CONTRACT_VERSION,
  PLATFORM_BOUNDARY_CONTRACTS,
  PLATFORM_SOURCE_OF_TRUTH,
  assertCapabilityOwner,
  getPlatformBoundaryContract,
} from "../dist/contracts/platformBoundaries.js";

assert.equal(PLATFORM_BOUNDARY_CONTRACT_VERSION, "platform-boundaries.2026-08-11");
assert.equal(PLATFORM_SOURCE_OF_TRUTH.operational_state, "ochiga-backend");
assert.equal(PLATFORM_SOURCE_OF_TRUTH.corporate_crm, "ochiga-office");
assert.equal(PLATFORM_SOURCE_OF_TRUTH.edge_runtime, "oyi-edge-agent");
assert.equal(PLATFORM_SOURCE_OF_TRUTH.conversation_runtime, "ochiga-backend");

const requiredContracts = [
  "edge-backend-runtime",
  "office-backend-intelligence-events",
  "website-office-crm-intake",
  "consumer-backend-operational-api",
  "facility-backend-operational-api",
  "conversation-domain-runtime-boundary",
];

for (const id of requiredContracts) {
  const contract = getPlatformBoundaryContract(id);
  assert.ok(contract, `missing ${id}`);
  assert.equal(contract.version, PLATFORM_BOUNDARY_CONTRACT_VERSION);
  assert.equal(contract.sourceOfTruth, PLATFORM_SOURCE_OF_TRUTH[contract.ownerCapability]);
}

assert.ok(assertCapabilityOwner("corporate_crm", "ochiga-office"));
assert.ok(assertCapabilityOwner("operational_state", "ochiga-backend"));
assert.ok(!assertCapabilityOwner("corporate_crm", "ochiga-backend"));
assert.equal(
  PLATFORM_BOUNDARY_CONTRACTS.filter((contract) => contract.id === "conversation-domain-runtime-boundary").length,
  1,
);

console.log("platform-boundary-contract-smoke: PASS");
