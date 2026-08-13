import type { AuthUser } from "../../../middleware/auth";
import { executeDeviceCommandForActor } from "../../../controllers/deviceCommandController";
import type { OyiAction } from "../../contracts/action";
import type { OyiDomainActionAdapter, DomainActionAdapterExecution } from "../../actions/ActionService";

function requestedBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").toLowerCase();
  if (["on", "true", "1"].includes(text)) return true;
  if (["off", "false", "0"].includes(text)) return false;
  return null;
}

export class DeviceConversationActionAdapter implements OyiDomainActionAdapter {
  readonly domain = "devices";

  constructor(private readonly actor: AuthUser, private readonly scope?: { estateId?: string | null; homeId?: string | null; roomId?: string | null }) {}

  async execute(action: OyiAction): Promise<DomainActionAdapterExecution> {
    if (!/^device\.power\.|devices\.(power|channel)\.control|turn_/.test(action.requested_operation)) {
      return {
        status: "failed",
        safe_error: { code: "unsupported_device_action", message: "Only device power/channel control is supported by this adapter." },
      };
    }
    const desired = requestedBoolean(action.requested_state);
    if (desired == null) {
      return {
        status: "failed",
        safe_error: { code: "missing_requested_state", message: "The requested device state is not clear." },
      };
    }
    const command = action.target.channel_code
      ? { [action.target.channel_code]: desired }
      : { switch: desired };
    const result: any = await executeDeviceCommandForActor({
      actor: this.actor,
      deviceId: action.target.canonical_id,
      command,
      source: "app",
      scope: this.scope,
      commandExecutionId: action.action_id,
    });
    const finalStatus = String(result?.final_status || result?.execution_status || result?.status || "");
    if (/provider_rejected/.test(finalStatus)) {
      return { status: "provider_rejected", executor_reference: { execution_id: result?.command_execution_id || action.action_id }, result };
    }
    if (/failed|state_mismatch|confirmation_timed_out/.test(finalStatus)) {
      return { status: "failed", executor_reference: { execution_id: result?.command_execution_id || action.action_id }, result };
    }
    if (/state_confirmed|confirmed/.test(finalStatus)) {
      return { status: "confirmed", executor_reference: { execution_id: result?.command_execution_id || action.action_id }, result };
    }
    if (/provider_accepted|provider_ack_only|not_observable/.test(finalStatus)) {
      return { status: "unobservable", executor_reference: { execution_id: result?.command_execution_id || action.action_id }, result };
    }
    return { status: "provider_accepted", executor_reference: { execution_id: result?.command_execution_id || action.action_id }, result };
  }

  async verify(_action: OyiAction, execution: DomainActionAdapterExecution): Promise<DomainActionAdapterExecution> {
    if (execution.status === "confirmed" || execution.status === "unobservable" || execution.status === "failed" || execution.status === "provider_rejected") return execution;
    return { ...execution, status: "unobservable" };
  }
}
