import type { ExecutionResult, VerificationResult } from "../contracts/capability";

export function verificationFromExecution(execution: ExecutionResult): VerificationResult {
  if (execution.status === "provider_accepted") {
    return { verified: false, status: "unobservable", evidence_id: execution.execution_id, metadata: execution.metadata || {} };
  }
  if (execution.status === "confirmed") {
    return { verified: true, status: "confirmed", evidence_id: execution.execution_id, metadata: execution.metadata || {} };
  }
  return { verified: false, status: execution.status || "unknown", evidence_id: execution.execution_id, metadata: execution.metadata || {} };
}
