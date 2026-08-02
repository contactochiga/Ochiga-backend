import type { AuthUser } from "../../middleware/auth";
import type { OisContext } from "../../types/oisContext";
import type { AuthorityDecision } from "./authority";
import type { PresentationPolicy } from "./presentation";
import type { SemanticFrame } from "./semanticFrame";
import type { CanonicalTarget, TargetSource } from "./target";

export type ResolvedTurn = {
  request_id: string;
  correlation_id: string;
  runtime_id: string;
  thread_id: string | null;
  actor: Pick<AuthUser, "id" | "role" | "permissions"> | null;
  semantic_frame: SemanticFrame;
  operation: string;
  capability_key: string;
  domain: string | null;
  scope: {
    estate_id: string | null;
    building_id: string | null;
    home_id: string | null;
    room_id: string | null;
  };
  target: CanonicalTarget | null;
  target_source: TargetSource;
  active_workflow_id: string | null;
  authority: AuthorityDecision;
  temporal_scope: SemanticFrame["temporalScope"];
  presentation_policy: PresentationPolicy;
  context: OisContext | Record<string, unknown> | null;
};
