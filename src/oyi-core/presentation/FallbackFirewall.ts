const BLOCKED_GENERIC_SUCCESS = [
  /done\.\s*home completed the request successfully/i,
  /everything i can verify looks normal/i,
  /home doesn'?t support that feature/i,
  /\bcompleted successfully\b/i,
  /\bhealthy\b/i,
];

export function assertNoUnverifiedGenericSuccess(answer: string, evidenceCount: number) {
  if (evidenceCount > 0) return;
  const matched = BLOCKED_GENERIC_SUCCESS.find((pattern) => pattern.test(answer || ""));
  if (matched) {
    throw new Error(`Unverified generic success fallback blocked: ${matched}`);
  }
}

export function safeUnsupportedAnswer(domain: string | null, operation: string) {
  const label = domain || "this area";
  return `I cannot complete that ${operation.replace(/_/g, " ")} conversationally yet for ${label}. No action was performed.`;
}
