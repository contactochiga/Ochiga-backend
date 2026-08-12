import { hasPermission } from "../../core/foundation";
import type { CommunicationParticipantRole, CommunicationSurface } from "./communicationContracts";

export type CommunicationPolicyAction =
  | "session.create"
  | "session.read"
  | "session.stop"
  | "participant.host"
  | "participant.view"
  | "participant.request_guest"
  | "participant.approve_guest"
  | "participant.publish_guest"
  | "participant.remove_guest"
  | "signal.relay"
  | "chat.send";

export type CommunicationPolicyInput = {
  surface: CommunicationSurface;
  action: CommunicationPolicyAction;
  actor?: any;
  role?: CommunicationParticipantRole;
};

const PUBLIC_SESSION_ACTIONS = new Set<CommunicationPolicyAction>([
  "session.create",
  "session.read",
  "participant.host",
  "participant.view",
  "signal.relay",
  "chat.send",
]);

export function communicationSurfaceCapability(surface: CommunicationSurface) {
  if (surface === "community") {
    return {
      read: "community.read",
      write: "community.write",
      create: "community.broadcast",
      stop: "community.write",
    };
  }
  if (surface === "office_internal") {
    return {
      read: "office.read",
      write: "office.manage",
      create: "office.manage",
      stop: "office.manage",
    };
  }
  if (surface === "support") {
    return {
      read: "support.read",
      write: "support.assign",
      create: "support.assign",
      stop: "support.assign",
    };
  }
  return {
    read: "office.public_communications",
    write: "office.public_communications",
    create: "office.public_communications",
    stop: "office.public_communications",
  };
}

export function canUseCommunicationSurface(input: CommunicationPolicyInput) {
  const surface = input.surface;
  const action = input.action;
  const actor = input.actor || {};
  const capability = communicationSurfaceCapability(surface);

  if (surface === "office_public") {
    if (PUBLIC_SESSION_ACTIONS.has(action)) return true;
    return hasPermission(actor, capability.write);
  }

  if (action === "session.create") return hasPermission(actor, capability.create);
  if (action === "session.stop") return hasPermission(actor, capability.stop);
  if (action === "session.read" || action === "participant.view" || action === "signal.relay") {
    return hasPermission(actor, capability.read);
  }

  if (surface === "community") {
    if (action === "participant.host" || action === "participant.approve_guest" || action === "participant.remove_guest") {
      return hasPermission(actor, capability.write);
    }
    if (action === "participant.request_guest" || action === "participant.publish_guest" || action === "chat.send") {
      return hasPermission(actor, capability.write);
    }
  }

  return hasPermission(actor, capability.write);
}

export function communicationSurfacePolicySummary(surface: CommunicationSurface) {
  const capability = communicationSurfaceCapability(surface);
  return {
    surface,
    required_permissions: capability,
    media: ["voice", "video"],
    transport: "browser_webrtc_socketio_signaling",
    provider_boundary: "twilio_network_traversal_only",
  };
}
