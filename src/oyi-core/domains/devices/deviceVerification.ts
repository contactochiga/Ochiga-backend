import type { ExecutionResult, VerificationResult } from "../../contracts/capability";

export function verifyDeviceExecution(execution: ExecutionResult): VerificationResult {
  if (execution.status === "provider_accepted" && execution.metadata?.provider_ack_only) {
    return { verified: false, status: "unobservable", evidence_id: execution.execution_id, metadata: execution.metadata };
  }
  return {
    verified: execution.status === "confirmed",
    status: execution.status,
    evidence_id: execution.execution_id,
    metadata: execution.metadata || {},
  };
}
