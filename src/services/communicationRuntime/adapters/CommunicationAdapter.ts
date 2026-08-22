// Oyi Communication Actions Runtime -- the interface every channel
// adapter implements. CommunicationRuntime.ts never touches a
// provider-specific shape directly; it calls these five methods and
// translates the result to/from CommunicationRecord itself.
import type {
  CommunicationChannel,
  CommunicationDispatchResult,
  CommunicationEvent,
  CommunicationRecord,
} from "../../../contracts/communication";

export type CommunicationAdapterValidation = { valid: boolean; reason: string | null };

export interface CommunicationAdapter {
  readonly channel: CommunicationChannel;
  readonly provider: string;
  isConfigured(): boolean;
  validate(record: CommunicationRecord): CommunicationAdapterValidation;
  send(record: CommunicationRecord): Promise<CommunicationDispatchResult>;
  // getStatus is optional -- most channels here are fire-and-report
  // (the provider tells us the outcome via webhook, not polling); only
  // implement it where a provider genuinely supports a status-pull API.
  getStatus?(providerMessageId: string): Promise<CommunicationDispatchResult | null>;
  normalizeWebhook(payload: unknown): CommunicationEvent[];
}
