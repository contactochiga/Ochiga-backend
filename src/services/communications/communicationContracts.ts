export type CommunicationSurface = "community" | "office_public" | "office_internal" | "support";

export type CommunicationMediaMode = "voice" | "video" | "audio_video";

export type CommunicationStatus = "starting" | "live" | "ended";

export type CommunicationParticipantRole = "host" | "viewer" | "guest" | "agent" | "staff" | "customer";

export type CommunicationScopeType = "community_post" | "office_public_session" | "office_internal_session" | "support_thread";

export type CommunicationSession = {
  session_id: string;
  surface: CommunicationSurface;
  purpose: string;
  scope_type: CommunicationScopeType;
  scope_id: string;
  estate_id?: string | null;
  home_id?: string | null;
  owner_id?: string | null;
  status: CommunicationStatus;
  media_mode: CommunicationMediaMode;
  viewer_count: number;
  started_at?: string | null;
  ended_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  is_live: boolean;
  has_guest: boolean;
  guest_user_id?: string | null;
  guest_display_name?: string | null;
  pending_request_count: number;
};

export type CommunicationParticipant = {
  session_id: string;
  socket_id: string;
  role: CommunicationParticipantRole;
  user_id?: string | null;
  display_name?: string | null;
  joined_at: string;
  left_at?: string | null;
};

export type CommunicationEventType =
  | "session.created"
  | "session.started"
  | "session.ended"
  | "participant.joined"
  | "participant.left"
  | "guest.requested"
  | "guest.approved"
  | "guest.rejected"
  | "guest.removed"
  | "signal.relayed"
  | "chat.sent"
  | "permission.denied";

export type CommunicationEvent = {
  event_id: string;
  session_id: string;
  surface: CommunicationSurface;
  event_type: CommunicationEventType;
  actor_id?: string | null;
  actor_role?: string | null;
  target_id?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
};

export type CommunicationRtcConfig = {
  iceServers: Array<{
    urls: string | string[];
    username?: string;
    credential?: string;
  }>;
  iceTransportPolicy?: "all" | "relay";
};

export type CommunicationGuestRequest = {
  socketId: string;
  userId: string;
  userName: string;
};

export type CommunicationChatMessage = {
  id: string;
  sessionId: string;
  userId: string;
  userName: string;
  text: string;
  createdAt: string;
};

export type CommunicationSessionCreateInput = {
  sessionId: string;
  surface: CommunicationSurface;
  purpose: string;
  scopeType: CommunicationScopeType;
  scopeId: string;
  estateId?: string | null;
  homeId?: string | null;
  ownerId?: string | null;
  mediaMode?: CommunicationMediaMode;
};
