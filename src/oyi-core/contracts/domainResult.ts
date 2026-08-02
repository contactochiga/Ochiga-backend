import type { PresentationPolicy } from "./presentation";

export type DomainResultStatus = "answered" | "empty" | "unavailable" | "unsupported" | "permission_restricted" | "draft" | "awaiting_confirmation";

export type DomainResult = {
  status: DomainResultStatus;
  answer: string;
  blocks?: Array<Record<string, unknown>>;
  actions?: Array<Record<string, unknown>>;
  presentation_policy?: PresentationPolicy;
  metadata?: Record<string, unknown>;
};
