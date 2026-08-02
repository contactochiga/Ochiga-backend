import { createHash } from "crypto";
import type { CanonicalTarget } from "../contracts/target";

export function actionIdempotencyKey(input: {
  actorId: string | null;
  threadId: string | null;
  target: CanonicalTarget | null;
  operation: string;
  requestedState: unknown;
}) {
  return createHash("sha256")
    .update(JSON.stringify({
      actor: input.actorId || null,
      thread: input.threadId || null,
      target: input.target ? `${input.target.object_type}:${input.target.canonical_id}:${input.target.channel_code || ""}` : null,
      operation: input.operation,
      requestedState: input.requestedState,
    }))
    .digest("hex");
}
