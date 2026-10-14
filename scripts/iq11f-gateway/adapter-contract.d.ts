/** Experiment-only interface. No execute, fetch, authority grant or adoption method. */
export interface InterpretationAdapter {
  readonly id: string;
  readonly version: 1;
  readonly mode: 'offline_mock_only';
  readonly protocol: string;
  describe(packet: unknown, approvedExactModel: string, limits: {input: number; output: number}): {
    provider: string; model: string; mode: 'offline_mock_only'; sendable: false;
    api_compatibility: 'UNQUALIFIED'; body: unknown;
  };
  normalize(recordedBody: unknown, approvedExactModel: string): {
    status: 'candidate' | 'refused' | 'incomplete' | 'invalid_response' | 'unexpected_output';
    /** Existing IQ-11E candidate, not a new SemanticFrame. Must be independently validated. */
    candidate: unknown | null;
    usage: {
      input_total: number | null; output_total: number | null;
      cached_input: number | null; cache_write: number | null; reasoning_output: number | null;
      semantics: string;
    } | null;
  };
}
