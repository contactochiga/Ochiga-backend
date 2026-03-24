type LiveStatus = "starting" | "live" | "ended";

export type CommunityLiveSession = {
  postId: string;
  estateId: string;
  hostUserId: string;
  hostSocketId: string | null;
  viewerSockets: Set<string>;
  status: LiveStatus;
  createdAt: string;
  updatedAt: string;
};

const sessions = new Map<string, CommunityLiveSession>();

function nowIso() {
  return new Date().toISOString();
}

function touch(session: CommunityLiveSession) {
  session.updatedAt = nowIso();
  return session;
}

function serialize(session: CommunityLiveSession | null | undefined) {
  if (!session) return null;
  return {
    post_id: session.postId,
    estate_id: session.estateId,
    host_user_id: session.hostUserId,
    status: session.status,
    viewer_count: session.viewerSockets.size,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    is_live: session.status === "live",
  };
}

export class CommunityLiveService {
  static start(input: { postId: string; estateId: string; hostUserId: string }) {
    const existing = sessions.get(input.postId);
    if (existing) {
      existing.status = "starting";
      existing.hostUserId = input.hostUserId;
      existing.estateId = input.estateId;
      existing.viewerSockets.clear();
      existing.hostSocketId = null;
      return serialize(touch(existing));
    }

    const session: CommunityLiveSession = {
      postId: input.postId,
      estateId: input.estateId,
      hostUserId: input.hostUserId,
      hostSocketId: null,
      viewerSockets: new Set<string>(),
      status: "starting",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    sessions.set(input.postId, session);
    return serialize(session);
  }

  static get(postId: string) {
    return serialize(sessions.get(String(postId || "")));
  }

  static bindHost(postId: string, socketId: string) {
    const session = sessions.get(String(postId || ""));
    if (!session) return null;
    session.hostSocketId = socketId;
    session.status = "live";
    return serialize(touch(session));
  }

  static addViewer(postId: string, socketId: string) {
    const session = sessions.get(String(postId || ""));
    if (!session || session.status === "ended") return null;
    session.viewerSockets.add(socketId);
    return serialize(touch(session));
  }

  static removeViewer(postId: string, socketId: string) {
    const session = sessions.get(String(postId || ""));
    if (!session) return null;
    session.viewerSockets.delete(socketId);
    return serialize(touch(session));
  }

  static stop(postId: string) {
    const session = sessions.get(String(postId || ""));
    if (!session) return null;
    session.status = "ended";
    session.viewerSockets.clear();
    session.hostSocketId = null;
    return serialize(touch(session));
  }

  static hostSocketId(postId: string) {
    return sessions.get(String(postId || ""))?.hostSocketId || null;
  }

  static detachSocket(socketId: string) {
    const impacted: Array<{ postId: string; session: ReturnType<typeof serialize>; ended: boolean }> = [];

    for (const [postId, session] of sessions.entries()) {
      let changed = false;
      let ended = false;

      if (session.hostSocketId === socketId) {
        session.hostSocketId = null;
        session.viewerSockets.clear();
        session.status = "ended";
        changed = true;
        ended = true;
      } else if (session.viewerSockets.has(socketId)) {
        session.viewerSockets.delete(socketId);
        changed = true;
      }

      if (changed) {
        impacted.push({ postId, session: serialize(touch(session)), ended });
      }
    }

    return impacted;
  }
}

