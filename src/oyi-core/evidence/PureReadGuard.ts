// Pure-read enforcement for planner evidence sources.
//
// RUNTIME: structural, not patched. Sources receive a ReadOnlyEvidenceDb (see
// ReadOnlyEvidenceDb.ts) that exposes only `select`; no write verb and no RPC exist on it.
// STATIC (this module): adapter modules under evidence/sources may import only an allowlist of
// readers and pure helpers. A new import must be reviewed and added here deliberately; the
// deny-list names writers/dispatchers that must never become reachable from a read.

export const PURE_READ_FORBIDDEN_IMPORTS: RegExp[] = [
  /goalRuntime|goalProposal|goalPersistence|goalOutcome/i,
  /decisionPersistence|decisionRuntime|decisionLedger/i,
  /predictionPersistence|recommendationPersistence|persistPrediction|persistForecast/i,
  /awarenessWriter|awarenessPersistence|writeAwareness/i,
  /workflowRuntime|workflowPersistence|workflowCreate/i,
  /communicationProposal|communicationDispatch|notificationDispatch|officeHandoffBridge|emailService|smsService/i,
  /actionProposal|pendingActionProposal|deviceActionAdapter|deviceCommand|executeDeviceAction/i,
  /memoryWriter|memoryPersistence|writeMemory/i,
  /learningPromotion|promoteLearning|learningPersistence/i,
];

export const PURE_READ_ALLOWED_IMPORTS: RegExp[] = [
  /^(?:\.\.?\/)+contracts\//,
  /^\.\.\/EvidenceEnvelope$/, /^\.\.\/EvidenceReadOutcome$/, /^\.\.\/ReadOnlyEvidenceDb$/, /^\.\/evidenceFromFact$/,
  /^(?:\.\.\/)+domains\/devices\/deviceEvidence$/,
  /^(?:\.\.\/)+domains\/contributorSummary$/,
  /^(?:\.\.\/)+runtime\/canonicalTurnResolution$/, /^(?:\.\.\/)+runtime\/languageUnderstanding$/,
  /^(?:\.\.\/)+modules\/cameras\/cameraAccess\.policy$/,
  /^(?:\.\.\/)+modules\/cameras\/cameraCurrentStateAuthority$/,
  /^(?:\.\.\/)+modules\/cameras\/cameraCurrentStatePresentation$/,
  /^(?:\.\.\/)+capabilities\/corporateKnowledgeAnswer$/,
  /^(?:\.\.\/)+context\/publicOpportunityObjective$/,
];

/** Import specifiers that are forbidden or not on the allowlist. Empty means the module is admissible. */
export function pureReadImportViolations(source: string): string[] {
  const imports = [...source.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm)].map(m => m[1]);
  return imports.filter(spec => PURE_READ_FORBIDDEN_IMPORTS.some(re => re.test(spec)) || !PURE_READ_ALLOWED_IMPORTS.some(re => re.test(spec)));
}
