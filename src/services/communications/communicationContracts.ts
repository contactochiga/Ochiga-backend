export type CommunicationSurface = "community" | "office_public" | "office_internal" | "support";

export type CommunicationMediaMode = "chat" | "voice" | "video" | "audio_video";

export type CommunicationStatus = "starting" | "live" | "ended";

export type CommunicationParticipantRole = "visitor" | "oyi" | "staff" | "specialist" | "host" | "viewer" | "guest" | "agent" | "customer";

export type CommunicationParticipantState = "invited" | "waiting" | "joined" | "left" | "declined";

export type CommunicationScopeType = "community_post" | "office_public_session" | "office_internal_session" | "support_thread";

export type CommunicationSession = {
  session_id: string;
  surface: CommunicationSurface;
  purpose: string;
  scope_type: CommunicationScopeType;
  scope_id: string;
  estate_id?: string | null;
  home_id?: string | null;
  owner_type?: string | null;
  owner_id?: string | null;
  public_session_id?: string | null;
  oyi_thread_id?: string | null;
  office_context_ref?: string | null;
  status: CommunicationStatus;
  media_mode: CommunicationMediaMode;
  viewer_count: number;
  started_at?: string | null;
  ended_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_activity_at?: string | null;
  metadata?: Record<string, unknown>;
  is_live: boolean;
  has_guest: boolean;
  guest_user_id?: string | null;
  guest_display_name?: string | null;
  pending_request_count: number;
};

export type CommunicationParticipant = {
  participant_id?: string;
  session_id: string;
  socket_id?: string | null;
  participant_type?: "visitor" | "oyi" | "staff" | "specialist" | "system";
  role: CommunicationParticipantRole;
  state?: CommunicationParticipantState;
  user_id?: string | null;
  public_session_id?: string | null;
  display_name?: string | null;
  permissions?: string[];
  invited_at?: string | null;
  accepted_at?: string | null;
  joined_at?: string | null;
  left_at?: string | null;
  metadata?: Record<string, unknown>;
};

export type CommunicationEventType =
  | "session.created"
  | "session.started"
  | "session.ended"
  | "session.failed"
  | "participant.invited"
  | "participant.joined"
  | "participant.left"
  | "role.changed"
  | "handoff.requested"
  | "handoff.assigned"
  | "handoff.accepted"
  | "handoff.declined"
  | "handoff.timed_out"
  | "callback.requested"
  | "media.changed"
  | "guest.requested"
  | "guest.approved"
  | "guest.rejected"
  | "guest.removed"
  | "signal.relayed"
  | "chat.sent"
  | "voice.transcribed"
  | "voice.responded"
  | "visual.observed"
  | "oyi.responded"
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

export type CommunicationHandoffStatus =
  | "requested"
  | "routing"
  | "offered"
  | "accepted"
  | "declined"
  | "timed_out"
  | "cancelled"
  | "completed";

export type CommunicationHandoffRequest = {
  handoff_id: string;
  communications_session_id: string;
  public_session_id?: string | null;
  oyi_thread_id?: string | null;
  office_context_ref?: string | null;
  business_unit: string;
  requested_capability: string;
  reason: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: CommunicationHandoffStatus;
  requested_at: string;
  assigned_staff_id?: string | null;
  accepted_at?: string | null;
  declined_at?: string | null;
  timed_out_at?: string | null;
  fallback_action?: "continue_with_oyi" | "request_callback" | "schedule_followup" | "leave_message";
  metadata?: Record<string, unknown>;
};

export type CommunicationStaffAvailability = "available" | "busy" | "away" | "offline";

export type CommunicationStaffCapability = {
  staff_id: string;
  business_unit: string;
  capability: string;
  specialty?: string | null;
  availability: CommunicationStaffAvailability;
  routing_priority: number;
  active: boolean;
  active_session_count?: number;
};

export type CommunicationConsent = {
  microphone: boolean;
  camera: boolean;
  visual_analysis: boolean;
};

export type OyiVoiceAdapterTurn = {
  communications_session_id: string;
  public_session_id?: string | null;
  oyi_thread_id: string;
  transcript_text: string;
  source_participant_id?: string | null;
  response_text?: string | null;
  synthesized_audio_ref?: string | null;
};

export type OyiVisualObservation = {
  communications_session_id: string;
  timestamp: string;
  source_participant_id: string;
  observation_type: "frame" | "image" | "document" | "scene";
  image_ref?: string | null;
  consent: CommunicationConsent;
  surface: CommunicationSurface;
  authorized_context?: Record<string, unknown>;
  analysis_status: "not_requested" | "pending" | "completed" | "rejected";
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
  ownerType?: string | null;
  ownerId?: string | null;
  publicSessionId?: string | null;
  oyiThreadId?: string | null;
  officeContextRef?: string | null;
  mediaMode?: CommunicationMediaMode;
  metadata?: Record<string, unknown>;
  consent?: CommunicationConsent;
};
