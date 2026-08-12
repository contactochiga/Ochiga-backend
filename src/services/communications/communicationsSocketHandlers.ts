import crypto from "crypto";
import type { Server as IOServer, Socket } from "socket.io";
import { canUseSocket, denySocket } from "../../socketAuth";
import { CommunityLiveService } from "../communityLiveService";
import type { CommunicationPolicyAction } from "./communicationsPolicy";
import { canUseCommunicationSurface, communicationSurfaceCapability } from "./communicationsPolicy";
import { CommunicationsLiveService } from "./communicationsLiveService";
import type { CommunicationSession } from "./communicationContracts";

export type CommunityCommunicationSocketAccess = {
  canAccessCommunityPost: (user: any, postId: string) => Promise<boolean>;
  canHostCommunityPost: (user: any, postId: string) => Promise<boolean>;
};

async function denyCommunity(socket: Socket, permission: string, postId: string) {
  return denySocket(socket, permission, "community_post", String(postId || ""));
}

async function canReadCommunityLive(socket: Socket, postId: string, access: CommunityCommunicationSocketAccess) {
  if (!canUseSocket(socket, "community.read")) {
    await denyCommunity(socket, "community.read", postId);
    return false;
  }
  if (!(await access.canAccessCommunityPost(socket.data.user, String(postId)))) {
    await denyCommunity(socket, "community.read", postId);
    return false;
  }
  return true;
}

async function canWriteCommunityLive(socket: Socket, postId: string, access: CommunityCommunicationSocketAccess) {
  if (!canUseSocket(socket, "community.write")) {
    await denyCommunity(socket, "community.write", postId);
    return false;
  }
  if (!(await access.canAccessCommunityPost(socket.data.user, String(postId)))) {
    await denyCommunity(socket, "community.read", postId);
    return false;
  }
  return true;
}

async function canHostCommunityLive(socket: Socket, postId: string, access: CommunityCommunicationSocketAccess) {
  if (!(await canWriteCommunityLive(socket, postId, access))) return false;
  if (!(await access.canHostCommunityPost(socket.data.user, String(postId)))) {
    await denyCommunity(socket, "community.host", postId);
    return false;
  }
  return true;
}

export function registerCommunityCommunicationSocketHandlers(
  io: IOServer,
  socket: Socket,
  access: CommunityCommunicationSocketAccess
) {
  socket.on("community-live:host:join", async ({ postId }: { postId: string }) => {
    if (!postId) return;
    if (!(await canHostCommunityLive(socket, String(postId), access))) return;
    console.log("[community-live] host join", { postId: String(postId), socketId: socket.id });
    socket.join(`community-live:${postId}:host`);
    socket.join(`community-live:${postId}:viewers`);
    socket.join(`community-live:${postId}:publishers`);
    const session = await CommunityLiveService.bindHost(String(postId), socket.id, socket.data.user?.id || null);
    io.to(`community-live:${postId}:viewers`).emit("community-live:stats", {
      postId: String(postId),
      live_session: session,
    });
  });

  socket.on("community-live:host:stop", async ({ postId }: { postId: string }) => {
    if (!postId) return;
    if (!(await canHostCommunityLive(socket, String(postId), access))) return;
    const session = await CommunityLiveService.stop(String(postId), socket.data.user?.id || null);
    io.to(`community-live:${postId}:viewers`).emit("community-live:stats", {
      postId: String(postId),
      live_session: session,
    });
    io.to(`community-live:${postId}:viewers`).emit("community-live:ended", {
      postId: String(postId),
      live_session: session,
    });
    io.to(`community-live:${postId}:host`).emit("community-live:guest-requests", {
      postId: String(postId),
      requests: [],
      live_session: session,
    });
  });

  socket.on("community-live:viewer:join", async ({ postId, userId, userName }: { postId: string; userId?: string; userName?: string }) => {
    if (!postId) return;
    if (!(await canReadCommunityLive(socket, String(postId), access))) return;
    console.log("[community-live] viewer join", {
      postId: String(postId),
      socketId: socket.id,
      userId: String(userId || ""),
      userName: String(userName || ""),
    });
    socket.join(`community-live:${postId}:viewers`);
    const session = await CommunityLiveService.addViewer(String(postId), socket.id, socket.data.user?.id || null);
    io.to(`community-live:${postId}:publishers`).emit("community-live:viewer-joined", {
      postId: String(postId),
      viewerSocketId: socket.id,
      userId: String(userId || ""),
      userName: String(userName || "Resident"),
      live_session: session,
    });
    io.to(`community-live:${postId}:viewers`).emit("community-live:stats", {
      postId: String(postId),
      live_session: session,
    });
  });

  socket.on(
    "community-live:signal",
    async ({
      postId,
      targetSocketId,
      kind,
      role,
      payload,
    }: {
      postId: string;
      targetSocketId: string;
      kind: "offer" | "answer" | "candidate";
      role?: "host" | "guest" | "viewer";
      payload: any;
    }) => {
      if (!postId || !targetSocketId || !kind) return;
      if (!(await canReadCommunityLive(socket, String(postId), access))) return;
      io.to(String(targetSocketId)).emit("community-live:signal", {
        postId: String(postId),
        sourceSocketId: socket.id,
        kind,
        role: role || "viewer",
        payload,
      });
    }
  );

  socket.on(
    "community-live:guest:request",
    async ({ postId, userId, userName }: { postId: string; userId?: string; userName?: string }) => {
      if (!postId) return;
      if (!(await canWriteCommunityLive(socket, String(postId), access))) return;
      console.log("[community-live] guest request", {
        postId: String(postId),
        socketId: socket.id,
        userId: String(userId || ""),
        userName: String(userName || ""),
        hostSocketId: CommunityLiveService.hostSocketId(String(postId)),
      });
      const result = await CommunityLiveService.requestGuest({
        postId: String(postId),
        socketId: socket.id,
        userId,
        userName,
      });
      if ((result as any)?.blocked) {
        socket.emit("community-live:guest-rejected", {
          postId: String(postId),
          reason: "A guest is already active.",
        });
        return;
      }
      socket.emit("community-live:guest-requested", {
        postId: String(postId),
        request: Array.isArray(result.requests)
          ? result.requests.find((item: any) => String(item?.socketId || "") === socket.id) || null
          : null,
        live_session: result.session,
      });
      io.to(`community-live:${postId}:host`).emit("community-live:guest-requests", {
        postId: String(postId),
        requests: result.requests,
        live_session: result.session,
      });
      io.to(`community-live:${postId}:publishers`).emit("community-live:guest-requests", {
        postId: String(postId),
        requests: result.requests,
        live_session: result.session,
      });
      const hostSocketId = CommunityLiveService.hostSocketId(String(postId));
      if (hostSocketId) {
        io.to(hostSocketId).emit("community-live:guest-requested-for-host", {
          postId: String(postId),
          requests: result.requests,
          live_session: result.session,
        });
      }
      io.to(`community-live:${postId}:viewers`).emit("community-live:guest-requests", {
        postId: String(postId),
        requests: result.requests,
        live_session: result.session,
      });
    }
  );

  socket.on("community-live:guest:approve", async ({ postId, viewerSocketId }: { postId: string; viewerSocketId: string }) => {
    if (!postId || !viewerSocketId) return;
    if (!(await canHostCommunityLive(socket, String(postId), access))) return;
    console.log("[community-live] guest approve", {
      postId: String(postId),
      hostSocketId: socket.id,
      viewerSocketId: String(viewerSocketId),
    });
    const result = await CommunityLiveService.approveGuest(String(postId), String(viewerSocketId), socket.data.user?.id || null);
    io.to(`community-live:${postId}:host`).emit("community-live:guest-requests", {
      postId: String(postId),
      requests: result.requests,
      live_session: result.session,
    });
    if (result.approved) {
      io.to(String(viewerSocketId)).emit("community-live:guest-approved", {
        postId: String(postId),
        audienceSocketIds: result.audienceSocketIds || [],
        request: result.approved,
        live_session: result.session,
      });
    }
  });

  socket.on("community-live:guest:reject", async ({ postId, viewerSocketId }: { postId: string; viewerSocketId: string }) => {
    if (!postId || !viewerSocketId) return;
    if (!(await canHostCommunityLive(socket, String(postId), access))) return;
    console.log("[community-live] guest reject", {
      postId: String(postId),
      hostSocketId: socket.id,
      viewerSocketId: String(viewerSocketId),
    });
    const result = await CommunityLiveService.rejectGuest(String(postId), String(viewerSocketId), socket.data.user?.id || null);
    io.to(`community-live:${postId}:host`).emit("community-live:guest-requests", {
      postId: String(postId),
      requests: result.requests,
      live_session: result.session,
    });
    io.to(String(viewerSocketId)).emit("community-live:guest-rejected", {
      postId: String(postId),
      reason: "Host declined your request to join.",
      live_session: result.session,
    });
  });

  socket.on(
    "community-live:guest:join",
    async ({ postId, userId, userName }: { postId: string; userId?: string; userName?: string }) => {
      if (!postId) return;
      if (!(await canWriteCommunityLive(socket, String(postId), access))) return;
      console.log("[community-live] guest join", {
        postId: String(postId),
        socketId: socket.id,
        userId: String(userId || ""),
        userName: String(userName || ""),
      });
      socket.join(`community-live:${postId}:publishers`);
      const result = await CommunityLiveService.bindGuest({
        postId: String(postId),
        socketId: socket.id,
        userId,
        userName,
      });
      socket.emit("community-live:audience-sync", {
        postId: String(postId),
        audienceSocketIds: result.audienceSocketIds,
        role: "guest",
        live_session: result.session,
      });
      io.to(`community-live:${postId}:viewers`).emit("community-live:publisher-joined", {
        postId: String(postId),
        publisherSocketId: socket.id,
        role: "guest",
        live_session: result.session,
      });
      io.to(`community-live:${postId}:host`).emit("community-live:guest-active", {
        postId: String(postId),
        live_session: result.session,
      });
      io.to(`community-live:${postId}:viewers`).emit("community-live:stats", {
        postId: String(postId),
        live_session: result.session,
      });
    }
  );

  socket.on("community-live:guest:remove", async ({ postId }: { postId: string }) => {
    if (!postId) return;
    if (!(await canHostCommunityLive(socket, String(postId), access))) return;
    const guestSocketId = CommunityLiveService.publisherSocketIds(String(postId)).find((id) => id !== CommunityLiveService.hostSocketId(String(postId)));
    const session = await CommunityLiveService.removeGuest(String(postId), null, socket.data.user?.id || null);
    if (guestSocketId) {
      io.to(String(guestSocketId)).emit("community-live:guest-removed", {
        postId: String(postId),
        live_session: session,
      });
    }
    io.to(`community-live:${postId}:viewers`).emit("community-live:publisher-left", {
      postId: String(postId),
      publisherSocketId: guestSocketId || null,
      role: "guest",
      live_session: session,
    });
    io.to(`community-live:${postId}:viewers`).emit("community-live:stats", {
      postId: String(postId),
      live_session: session,
    });
    io.to(`community-live:${postId}:host`).emit("community-live:guest-requests", {
      postId: String(postId),
      requests: CommunityLiveService.getPendingRequests(String(postId)),
      live_session: session,
    });
  });

  socket.on(
    "community-live:chat:send",
    async ({ postId, userId, userName, text }: { postId: string; userId?: string; userName?: string; text?: string }) => {
      if (!postId) return;
      if (!(await canWriteCommunityLive(socket, String(postId), access))) return;
      const message = CommunityLiveService.addChatMessage({
        postId: String(postId),
        userId,
        userName,
        text,
      });
      if (!message) return;
      io.to(`community-live:${postId}:viewers`).emit("community-live:chat", {
        postId: String(postId),
        message,
      });
      io.to(`community-live:${postId}:host`).emit("community-live:chat", {
        postId: String(postId),
        message,
      });
    }
  );

  socket.on("community-live:leave", async ({ postId }: { postId: string }) => {
    if (!postId) return;
    if (!(await canReadCommunityLive(socket, String(postId), access))) return;
    socket.leave(`community-live:${postId}:viewers`);
    const beforeGuestSocketId = CommunityLiveService.publisherSocketIds(String(postId)).find((id) => id !== CommunityLiveService.hostSocketId(String(postId)));
    const session = beforeGuestSocketId === socket.id
      ? await CommunityLiveService.removeGuest(String(postId), socket.id, socket.data.user?.id || null)
      : await CommunityLiveService.removeViewer(String(postId), socket.id);
    if (beforeGuestSocketId === socket.id) {
      socket.leave(`community-live:${postId}:publishers`);
      io.to(`community-live:${postId}:viewers`).emit("community-live:publisher-left", {
        postId: String(postId),
        publisherSocketId: socket.id,
        role: "guest",
        live_session: session,
      });
      io.to(`community-live:${postId}:host`).emit("community-live:guest-requests", {
        postId: String(postId),
        requests: CommunityLiveService.getPendingRequests(String(postId)),
        live_session: session,
      });
    } else {
      io.to(`community-live:${postId}:publishers`).emit("community-live:viewer-left", {
        postId: String(postId),
        viewerSocketId: socket.id,
        live_session: session,
      });
    }
    io.to(`community-live:${postId}:viewers`).emit("community-live:stats", {
      postId: String(postId),
      live_session: session,
    });
  });
}

function signingSecret() {
  return process.env.APP_JWT_SECRET || process.env.OFFICE_SYNC_API_KEY || process.env.OFFICE_EXPORT_API_KEY || "";
}

function timingSafeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyCommunicationToken(token: string | undefined, session: CommunicationSession | null) {
  const secret = signingSecret();
  if (!secret || !token || !session) return false;
  const [encoded, signature] = String(token).split(".");
  if (!encoded || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  if (!timingSafeEqual(signature, expected)) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (String(payload.session_id || "") !== String(session.session_id || "")) return false;
    if (String(payload.surface || "") !== String(session.surface || "")) return false;
    if (Number(payload.exp || 0) < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
}

function communicationRoom(sessionId: string) {
  return `communications:${sessionId}`;
}

function communicationPublishersRoom(sessionId: string) {
  return `communications:${sessionId}:publishers`;
}

function denyCommunication(socket: Socket, session: CommunicationSession | null, action: CommunicationPolicyAction, sessionId: string) {
  const surface = session?.surface || "support";
  const required = communicationSurfaceCapability(surface).read;
  return denySocket(socket, required, "communication_session", sessionId || session?.session_id || "");
}

function canUseGenericCommunicationSocket(
  socket: Socket,
  session: CommunicationSession | null,
  action: CommunicationPolicyAction,
  signalingToken: string | undefined
) {
  if (!session) {
    denyCommunication(socket, null, action, "");
    return false;
  }
  if (session.surface === "community") {
    denyCommunication(socket, session, action, session.session_id);
    return false;
  }
  if (!verifyCommunicationToken(signalingToken, session)) {
    denyCommunication(socket, session, action, session.session_id);
    return false;
  }
  if (canUseCommunicationSurface({ surface: session.surface, action, actor: socket.data.user || {} })) return true;
  denyCommunication(socket, session, action, session.session_id);
  return false;
}

export function registerGenericCommunicationSocketHandlers(io: IOServer, socket: Socket) {
  socket.on("communications:host:join", async ({ sessionId, signalingToken }: { sessionId: string; signalingToken?: string }) => {
    const id = String(sessionId || "");
    if (!id) return;
    const session = CommunicationsLiveService.get(id);
    if (!canUseGenericCommunicationSocket(socket, session, "participant.host", signalingToken)) return;
    socket.join(communicationRoom(id));
    socket.join(communicationPublishersRoom(id));
    const next = await CommunicationsLiveService.bindHost(id, socket.id, socket.data.user?.id || null);
    io.to(communicationRoom(id)).emit("communications:stats", { session_id: id, session: next });
  });

  socket.on("communications:participant:join", async ({ sessionId, signalingToken }: { sessionId: string; signalingToken?: string }) => {
    const id = String(sessionId || "");
    if (!id) return;
    const session = CommunicationsLiveService.get(id);
    if (!canUseGenericCommunicationSocket(socket, session, "participant.view", signalingToken)) return;
    socket.join(communicationRoom(id));
    const next = await CommunicationsLiveService.addViewer(id, socket.id, socket.data.user?.id || null);
    io.to(communicationPublishersRoom(id)).emit("communications:participant-joined", {
      session_id: id,
      socket_id: socket.id,
      session: next,
    });
    io.to(communicationRoom(id)).emit("communications:stats", { session_id: id, session: next });
  });

  socket.on(
    "communications:signal",
    async ({
      sessionId,
      signalingToken,
      targetSocketId,
      kind,
      role,
      payload,
    }: {
      sessionId: string;
      signalingToken?: string;
      targetSocketId: string;
      kind: "offer" | "answer" | "candidate";
      role?: "host" | "guest" | "viewer" | "agent" | "staff" | "customer";
      payload: any;
    }) => {
      const id = String(sessionId || "");
      if (!id || !targetSocketId || !kind) return;
      const session = CommunicationsLiveService.get(id);
      if (!canUseGenericCommunicationSocket(socket, session, "signal.relay", signalingToken)) return;
      io.to(String(targetSocketId)).emit("communications:signal", {
        session_id: id,
        sourceSocketId: socket.id,
        kind,
        role: role || "viewer",
        payload,
      });
    }
  );

  socket.on("communications:chat:send", async ({ sessionId, signalingToken, text }: { sessionId: string; signalingToken?: string; text?: string }) => {
    const id = String(sessionId || "");
    if (!id) return;
    const session = CommunicationsLiveService.get(id);
    if (!canUseGenericCommunicationSocket(socket, session, "chat.send", signalingToken)) return;
    const message = CommunicationsLiveService.addChatMessage({
      sessionId: id,
      userId: socket.data.user?.id || null,
      userName: socket.data.user?.username || socket.data.user?.email || "Participant",
      text,
    });
    if (!message) return;
    io.to(communicationRoom(id)).emit("communications:chat", { session_id: id, message });
  });

  socket.on("communications:leave", async ({ sessionId, signalingToken }: { sessionId: string; signalingToken?: string }) => {
    const id = String(sessionId || "");
    if (!id) return;
    const session = CommunicationsLiveService.get(id);
    if (!canUseGenericCommunicationSocket(socket, session, "participant.view", signalingToken)) return;
    socket.leave(communicationRoom(id));
    socket.leave(communicationPublishersRoom(id));
    const next = await CommunicationsLiveService.removeViewer(id, socket.id);
    io.to(communicationPublishersRoom(id)).emit("communications:participant-left", {
      session_id: id,
      socket_id: socket.id,
      session: next,
    });
    io.to(communicationRoom(id)).emit("communications:stats", { session_id: id, session: next });
  });

  socket.on("communications:session:stop", async ({ sessionId, signalingToken }: { sessionId: string; signalingToken?: string }) => {
    const id = String(sessionId || "");
    if (!id) return;
    const session = CommunicationsLiveService.get(id);
    if (!canUseGenericCommunicationSocket(socket, session, "session.stop", signalingToken)) return;
    const next = await CommunicationsLiveService.stop(id, socket.data.user?.id || null);
    io.to(communicationRoom(id)).emit("communications:stats", { session_id: id, session: next });
    io.to(communicationRoom(id)).emit("communications:ended", { session_id: id, session: next });
  });
}

export async function emitCommunicationSocketDisconnect(io: IOServer, socketId: string) {
  const impacted = await CommunicationsLiveService.detachSocket(socketId);
  for (const item of impacted) {
    if (item.session?.surface === "community") {
      io.to(`community-live:${item.sessionId}:viewers`).emit("community-live:stats", {
        postId: item.sessionId,
        live_session: item.session,
      });
      io.to(`community-live:${item.sessionId}:host`).emit("community-live:guest-requests", {
        postId: item.sessionId,
        requests: item.requests,
        live_session: item.session,
      });
      if (item.guestLeft) {
        io.to(`community-live:${item.sessionId}:viewers`).emit("community-live:publisher-left", {
          postId: item.sessionId,
          publisherSocketId: socketId,
          role: "guest",
          live_session: item.session,
        });
      }
      if (item.ended) {
        io.to(`community-live:${item.sessionId}:viewers`).emit("community-live:ended", {
          postId: item.sessionId,
          live_session: item.session,
        });
      }
      continue;
    }

    io.to(communicationRoom(item.sessionId)).emit("communications:stats", {
      session_id: item.sessionId,
      session: item.session,
    });
    io.to(communicationPublishersRoom(item.sessionId)).emit("communications:participant-left", {
      session_id: item.sessionId,
      socket_id: socketId,
      session: item.session,
    });
    if (item.ended) {
      io.to(communicationRoom(item.sessionId)).emit("communications:ended", {
        session_id: item.sessionId,
        session: item.session,
      });
    }
  }
}
