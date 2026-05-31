export interface ResidentInviteContract {
  invite_id: string;
  estate_id: string;
  home_id: string;
  invited_email?: string | null;
  invited_phone?: string | null;
  role: "owner" | "admin" | "resident" | "guest";
  expires_at: string;
}

export interface ResidentInviteCompletionContract {
  invite_token: string;
  username: string;
  password: string;
}

export interface ResidentInviteCompletionResult {
  user_id: string;
  estate_id: string;
  home_id: string;
  onboarding_complete: boolean;
}
