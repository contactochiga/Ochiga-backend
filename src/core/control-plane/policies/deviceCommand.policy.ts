import { Signal } from "../contracts/signal.types";
import { Intent } from "../contracts/intent.types";
import { INTENT_SCHEMA_VERSION } from "../contracts/versions";

export function deviceCommandPolicy(signal: Signal): Intent[] {
  if (signal.type !== "device.command.requested") return [];

  const anySig: any = signal;
  if (!anySig.deviceId || !anySig.command) return [];

  // Wave 5D -- thread the REAL actor identity/scope that ingestSignal
  // (signal.controller.ts) already attached onto this signal --
  // requestedBy.userId/role (from the authenticated caller's own
  // req.user), estateId/homeId (from req.oisContext/req.user) -- through
  // to the queued DeviceCommandIntent, so intentWorker.ts can run the
  // SAME canonical DeviceCommandAuthority/executeDeviceCommandForActor
  // gate every other physical-command entrance already runs through,
  // instead of dispatching directly with no authority context at all.
  // Never fabricated: if requestedBy is genuinely absent, actor is
  // simply omitted here and the worker fails that job closed rather
  // than inventing an identity.
  const actor = anySig.requestedBy?.userId && anySig.requestedBy?.role
    ? {
        id: String(anySig.requestedBy.userId),
        role: String(anySig.requestedBy.role),
        estateId: anySig.estateId ?? null,
        homeId: anySig.homeId ?? null,
        roomId: anySig.roomId ?? null,
      }
    : undefined;

  return [
    {
      schemaVersion: INTENT_SCHEMA_VERSION,
      target: "device",
      priority: "high",
      reason: "user_device_command",
      deviceId: anySig.deviceId,
      command: anySig.command,
      actor,
      context: {
        source_signal: signal.type,
        created_at: new Date().toISOString(),
      },
    },
  ];
}
