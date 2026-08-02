import type { OyiEvidence } from "../contracts/evidence";

export function evidenceWithinScope(evidence: OyiEvidence, scope: { estate_id?: string | null; home_id?: string | null; room_id?: string | null }) {
  if (scope.estate_id && evidence.authorised_scope.estate_id && scope.estate_id !== evidence.authorised_scope.estate_id) return false;
  if (scope.home_id && evidence.authorised_scope.home_id && scope.home_id !== evidence.authorised_scope.home_id) return false;
  if (scope.room_id && evidence.authorised_scope.room_id && scope.room_id !== evidence.authorised_scope.room_id) return false;
  return true;
}
