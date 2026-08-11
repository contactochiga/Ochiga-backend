import type {
  IntelligenceFact,
  OperationalObject,
} from "../../contracts/canonicalConversation";
import type { IntelligenceRequestContract } from "../../interpretation/conversationIntentRouting";
import { reportEvidenceProfile, reportGenerationRequested } from "./reportEvidence";

function text(value: unknown) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function reportTitle(object: OperationalObject | null, contract: IntelligenceRequestContract) {
  if (object && contract.scope_mode === "exact_target") return `${object.label} report`;
  if (contract.scope_mode === "building_scope") return "Building operational report";
  if (contract.scope_mode === "estate_scope") return "Estate operational report";
  return "Home operational report";
}

export function buildReportAnswer(facts: IntelligenceFact[], object: OperationalObject | null, contract: IntelligenceRequestContract, message = "") {
  const changes = facts.slice(0, 6);
  const profile = reportEvidenceProfile(facts, contract);
  const generated = reportGenerationRequested(message);
  const periodTo = contract.temporal_scope.to || new Date().toISOString();
  const periodFrom = contract.temporal_scope.from || "current";
  const keyChanges = changes.length
    ? `Key changes:\n${changes.map((fact) => `- ${fact.statement}`).join("\n")}`
    : "Key changes: none recorded.";
  const generationBoundary = generated
    ? "Report generation: this is an analytical conversation answer. No persisted/exported report artifact was created."
    : "Report generation: not requested for this turn.";
  return [
    reportTitle(object, contract),
    `Period: ${periodFrom} to ${periodTo}.`,
    `Summary: ${profile.evidence_count ? `${profile.evidence_count} meaningful evidence item${profile.evidence_count === 1 ? "" : "s"} found.` : "No meaningful changes found."}`,
    `Unresolved items: ${profile.unresolved_count}.`,
    keyChanges,
    generationBoundary,
    "Limitations: Oyi reports only authorised records and does not infer physical appliance effects, trends, or predictions without separate intelligence evidence.",
  ].filter((line) => text(line)).join("\n");
}
