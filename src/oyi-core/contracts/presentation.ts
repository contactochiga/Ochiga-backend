export type PresentationPolicy = {
  primary: "text" | "list" | "table" | "detail" | "clarification" | "review" | "approval" | "execution" | "navigation";
  allowed_supporting_blocks: string[];
  allowed_action_types: string[];
  suppress_awareness: boolean;
  suppress_context_chips: boolean;
  suppress_duplicate_status: boolean;
  snapshot_mode: "none" | "historical" | "current_state_snapshot";
  auto_navigation: boolean;
};
