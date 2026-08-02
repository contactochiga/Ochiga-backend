export type CanonicalTarget = {
  object_type: string;
  canonical_id: string;
  label: string | null;
  parent_id?: string | null;
  channel_code?: string | null;
  room_id?: string | null;
  home_id?: string | null;
  estate_id?: string | null;
};

export type TargetSource =
  | "active_workflow"
  | "current_turn"
  | "current_scope"
  | "valid_reference"
  | "page_context"
  | "thread_memory"
  | "none";
