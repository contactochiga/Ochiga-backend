import { Request } from "express";
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { AuditEventContract } from "./contracts";
import { emitSignal, makeBaseSignal } from "../../realtime/emitSignal";

export const FOUNDATION_EVENT_NAMES = [
  "user.login",
  "user.invited",
  "staff.created",
  "estate.created",
  "home.created",
  "device.registered",
  "device.command.requested",
  "device.command.executed",
  "visitor.created",
  "wallet.funded",
  "support.ticket.created",
  "support.ticket.assigned",
  "document.generated",
  "plan.uploaded",
  "twin.device.action",
  "edge.heartbeat",
  "permission.denied",
  "ai.command.received",
  "ai.tool.requested",
  "ai.tool.executed",
  "ai.tool.denied",
  "ai.voice.transcribed",
  "ai.response.generated",
  "ai.command.confirmation.required",
  "ai.command.confirmed",
  "ai.command.cancelled",
  "ai.action.failed",
  "auth.invite.validated",
  "auth.invite.validation_failed",
  "auth.invite.activated",
  "auth.invite.activation_failed",
  "resident.invite.revoked",
  "resident.invite.resent",
  "communication.sent",
  "communication.failed",
  "facility.provisioned",
  "facility.invitation.created",
  "facility.invitation.validated",
  "facility.invitation.validation_failed",
  "facility.invitation.accepted",
  "facility.invitation.activation_failed",
  "auth.signup",
  "team.member.invited",
  "team.member.invite_failed",
  "team.member.invite_revoked",
  "team.member.invite_resent",
  "team.member.updated",
  "team.member.removed",
  "facility.profile.updated",
  "facility.profile.update_failed",
  "automation.policy.changed",
] as const;

function requestIp(req?: Request) {
  return String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim() || req?.socket?.remoteAddress || "";
}

export async function emitAuditEvent(input: Omit<AuditEventContract, "timestamp"> & { req?: Request }) {
  const isResidentDeviceAudit = input.resourceType === "device" && /^device\./.test(String(input.action || "")) && Boolean((input as any).homeId);
  const signalMetadata = {
    ...(input.metadata || {}),
    home_id: (input as any).homeId || null,
    privacy_class: isResidentDeviceAudit ? "resident_device_private" : (input.metadata as any)?.privacy_class || null,
    projection_policy: isResidentDeviceAudit ? "consumer_private" : (input.metadata as any)?.projection_policy || null,
  };
  const row = {
    actor_id: input.actorId || null,
    actor_email: input.actorEmail || "",
    actor_role: input.actorRole || "",
    action: input.action,
    resource_type: input.resourceType,
    resource_id: input.resourceId || "",
    estate_id: input.estateId || null,
    home_id: (input as any).homeId || null,
    status: input.status || "success",
    ip: input.ip || requestIp(input.req),
    user_agent: input.userAgent || String(input.req?.headers?.["user-agent"] || ""),
    metadata: signalMetadata,
  };

  const { error } = await supabaseAdmin.from("audit_events").insert(row as any);
  if (error) {
    // Keep production actions alive even if audit migration is not applied yet.
    console.warn("[audit] write failed:", error.message);
  }
  if (isResidentDeviceAudit) return;
	  emitSignal(makeBaseSignal({
	    type: "audit.recorded",
	    source: "audit",
	    estateId: input.estateId || undefined,
	    homeId: (input as any).homeId || undefined,
	    action: input.action,
	    resourceType: input.resourceType,
	    resourceId: input.resourceId,
	    metadata: signalMetadata,
	    requestedBy: {
      userId: input.actorId || "",
      role: input.actorRole || "",
    },
  } as any));
}
