export type AuthorityTier = 0 | 1 | 2 | 3 | 4;

export type AuthorityDecision = {
  allowed: boolean;
  tier: AuthorityTier;
  approval_required: boolean;
  secure_review_required: boolean;
  required_permissions: string[];
  denial_reason: string | null;
};
