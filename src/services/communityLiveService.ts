import { CommunicationsLiveService } from "./communications/communicationsLiveService";
import { getCommunicationRtcConfig } from "./communications/communicationsRtcConfig";

export type LiveStatus = "starting" | "live" | "ended";

export type LiveChatMessage = {
  id: string;
  postId: string;
  userId: string;
  userName: string;
  text: string;
  createdAt: string;
};

export type CommunityLiveSession = {
  post_id: string;
  estate_id: string;
  host_user_id: string;
  status: LiveStatus;
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

function toCommunitySession(session: ReturnType<typeof CommunicationsLiveService.get>): CommunityLiveSession | null {
  if (!session) return null;
  return {
    post_id: session.scope_id || session.session_id,
    estate_id: String(session.estate_id || ""),
    host_user_id: String(session.owner_id || ""),
    status: session.status,
    viewer_count: session.viewer_count,
    started_at: session.started_at || null,
    ended_at: session.ended_at || null,
    created_at: session.created_at || null,
    updated_at: session.updated_at || null,
    is_live: session.is_live,
    has_guest: session.has_guest,
    guest_user_id: session.guest_user_id || null,
    guest_display_name: session.guest_display_name || null,
    pending_request_count: session.pending_request_count,
  };
}

function toCommunityChat(message: any): LiveChatMessage {
  return {
    id: String(message.id || ""),
    postId: String(message.postId || message.sessionId || ""),
    userId: String(message.userId || ""),
    userName: String(message.userName || "Resident"),
    text: String(message.text || ""),
    createdAt: String(message.createdAt || new Date().toISOString()),
  };
}

export class CommunityLiveService {
  static async init() {
    return CommunicationsLiveService.init();
  }

  static get(postId: string) {
    return toCommunitySession(CommunicationsLiveService.get(postId));
  }

  static getPendingRequests(postId: string) {
    return CommunicationsLiveService.getPendingRequests(postId);
  }

  static listChatMessages(postId: string) {
    return CommunicationsLiveService.listChatMessages(postId).map(toCommunityChat);
  }

  static audienceSocketIds(postId: string) {
    return CommunicationsLiveService.audienceSocketIds(postId);
  }

  static guestAudienceSocketIds(postId: string) {
    return CommunicationsLiveService.guestAudienceSocketIds(postId);
  }

  static publisherSocketIds(postId: string) {
    return CommunicationsLiveService.publisherSocketIds(postId);
  }

  static async start(input: { postId: string; estateId: string; hostUserId: string }) {
    return toCommunitySession(await CommunicationsLiveService.start({
      sessionId: String(input.postId),
      surface: "community",
      purpose: "community_live",
      scopeType: "community_post",
      scopeId: String(input.postId),
      estateId: String(input.estateId),
      ownerId: String(input.hostUserId),
      mediaMode: "audio_video",
    }));
  }

  static async bindHost(postId: string, socketId: string, actorId?: string | null) {
    return toCommunitySession(await CommunicationsLiveService.bindHost(postId, socketId, actorId));
  }

  static async addViewer(postId: string, socketId: string, actorId?: string | null) {
    return toCommunitySession(await CommunicationsLiveService.addViewer(postId, socketId, actorId));
  }

  static async removeViewer(postId: string, socketId: string) {
    return toCommunitySession(await CommunicationsLiveService.removeViewer(postId, socketId));
  }

  static async requestGuest(input: { postId: string; socketId: string; userId?: string | null; userName?: string | null }) {
    const result = await CommunicationsLiveService.requestGuest({
      sessionId: String(input.postId),
      socketId: String(input.socketId),
      userId: input.userId,
      userName: input.userName,
    });
    return {
      ...result,
      session: toCommunitySession(result.session),
    };
  }

  static addChatMessage(input: {
    postId: string;
    userId?: string | null;
    userName?: string | null;
    text?: string | null;
  }) {
    const message = CommunicationsLiveService.addChatMessage({
      sessionId: String(input.postId),
      userId: input.userId,
      userName: input.userName,
      text: input.text,
    });
    return message ? toCommunityChat(message) : null;
  }

  static async approveGuest(postId: string, socketId: string, actorId?: string | null) {
    const result = await CommunicationsLiveService.approveGuest(postId, socketId, actorId);
    return {
      ...result,
      session: toCommunitySession(result.session),
    };
  }

  static async rejectGuest(postId: string, socketId: string, actorId?: string | null) {
    const result = await CommunicationsLiveService.rejectGuest(postId, socketId, actorId);
    return {
      ...result,
      session: toCommunitySession(result.session),
    };
  }

  static async bindGuest(input: { postId: string; socketId: string; userId?: string | null; userName?: string | null }) {
    const result = await CommunicationsLiveService.bindGuest({
      sessionId: String(input.postId),
      socketId: String(input.socketId),
      userId: input.userId,
      userName: input.userName,
    });
    return {
      ...result,
      session: toCommunitySession(result.session),
    };
  }

  static async removeGuest(postId: string, socketId?: string | null, actorId?: string | null) {
    return toCommunitySession(await CommunicationsLiveService.removeGuest(postId, socketId, actorId));
  }

  static async stop(postId: string, actorId?: string | null) {
    return toCommunitySession(await CommunicationsLiveService.stop(postId, actorId));
  }

  static hostSocketId(postId: string) {
    return CommunicationsLiveService.hostSocketId(postId);
  }

  static hostUserId(postId: string) {
    return CommunicationsLiveService.hostUserId(postId);
  }

  static async detachSocket(socketId: string) {
    const impacted = await CommunicationsLiveService.detachSocket(socketId);
    return impacted.map((item) => ({
      postId: item.sessionId,
      session: toCommunitySession(item.session),
      ended: item.ended,
      guestLeft: item.guestLeft,
      requests: item.requests,
    }));
  }

  static async rtcConfig() {
    return getCommunicationRtcConfig();
  }
}
