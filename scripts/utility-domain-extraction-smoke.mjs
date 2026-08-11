import fs from "fs";
import assert from "assert";

const read = (file) => fs.readFileSync(file, "utf8");

const runtime = read("src/oyi-core/runtime/canonicalConversationRuntime.ts");
const utilityEvidence = read("src/oyi-core/domains/utilities/utilityEvidence.ts");
const utilityAnswers = read("src/oyi-core/domains/utilities/utilityConversationAnswers.ts");
const walletEvidence = read("src/oyi-core/domains/wallet/walletEvidence.ts");
const presentation = read("src/oyi-core/presentation/conversationAnswerPresentation.ts");

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

check("utility facts reuse wallet transaction evidence instead of duplicating queries", () => {
  assert.match(utilityEvidence, /loadUtilitySpendingFacts/);
  assert.match(utilityEvidence, /loadWalletTransactionFacts/);
  assert.match(walletEvidence, /\.from\("wallet_transactions"\)/);
  assert.doesNotMatch(utilityEvidence, /\.from\("wallet_transactions"\)/);
});

check("utility evidence owns utility-domain filtering and permission enrichment", () => {
  assert.match(utilityEvidence, /isUtilityTransactionFact/);
  assert.match(utilityEvidence, /domain: "utilities"/);
  assert.match(utilityEvidence, /utilities\.read/);
});

check("utility answer shaping is outside the runtime and presentation monolith", () => {
  assert.match(utilityAnswers, /utilitySpendingRows/);
  assert.match(utilityAnswers, /buildUtilitySpendingAnswer/);
  assert.match(runtime, /loadUtilitySpendingFacts/);
  assert.match(runtime, /buildUtilitySpendingAnswer/);
  assert.doesNotMatch(runtime, /function utilitySpendingRows/);
  assert.doesNotMatch(presentation, /function utilitySpendingRows/);
  assert.doesNotMatch(presentation, /export function buildUtilitySpendingAnswer/);
});

check("utility spending remains a read-only canonical domain branch", () => {
  assert.match(runtime, /answer_builder === "utility_spending"/);
  assert.match(runtime, /displayMode = "list"/);
  assert.doesNotMatch(runtime, /executeUtility|dispatchUtility|confirmUtility/i);
});

console.log("utility-domain-extraction-smoke passed");
