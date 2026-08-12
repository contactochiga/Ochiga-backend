import { randomBytes } from "crypto";
import { supabaseAdmin } from "../../supabase/supabaseClient";
import {
  CommunicationChatMessage,
  CommunicationEvent,
  CommunicationGuestRequest,
  CommunicationSession,
  CommunicationSessionCreateInput,
  CommunicationStatus,
} from "./communicationContracts";

type PersistedSession = {
  session_id: string;
  surface: CommunicationSession["surface"];
  purpose: string;
  scope_type: CommunicationSession["scope_type"];
  scope_id: string;
  estate_id?: string | null;
  home_id?: string | null;
  owner_id?: string | null;
  status: CommunicationStatus;
  media_mode: CommunicationSession["media_mode"];
  viewer_count: number;
  started_at?: string | null;
  ended_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type RuntimeSession = {
  sessionId: string;
  hostSocketId: string | null;
  viewerSockets: Set<string>;
  guestSocketId: string | null;
  guestUserId: string | null;
  guestDisplayName: string | null;
  pendingRequests: Map<string, CommunicationGuestRequest>;
  chatMessages: CommunicationChatMessage[];
};

const persisted = new Map<string, PersistedSession>();
const runtime = new Map<string, RuntimeSession>();
const events: CommunicationEvent[] = [];
let initPromise: Promise<void> | null = null;

function nowIso() {
  return new Date().toISOString();
}

function isMissingLiveTable(error: any) {
  const msg = String(error?.message || error || "").toLowerCase();
  return msg.includes("community_live_sessions") && msg.includes("could not find");
}

function runtimeSession(sessionId: string) {
  const key = String(sessionId || "");
  let entry = runtime.get(key);
  if (!entry) {
    entry = {
      sessionId: key,
      hostSocketId: null,
      viewerSockets: new Set<string>(),
      guestSocketId: null,
      guestUserId: null,
      guestDisplayName: null,
      pendingRequests: new Map<string, CommunicationGuestRequest>(),
      chatMessages: [],
    };
    runtime.set(key, entry);
  }
  return entry;
}

function serialize(sessionId: string): CommunicationSession | null {
  const row = persisted.get(String(sessionId || ""));
  if (!row) return null;
  const session = runtime.get(String(sessionId || ""));
  const viewerCount = session
    ? Array.from(session.viewerSockets).filter((socketId) => socketId !== session.guestSocketId).length
    : Number(row.viewer_count || 0);
  const status: CommunicationStatus =
    row.status === "live" || row.status === "starting" || row.status === "ended"
      ? row.status
      : "ended";
  return {
    session_id: row.session_id,
    surface: row.surface,
    purpose: row.purpose,
    scope_type: row.scope_type,
    scope_id: row.scope_id,
    estate_id: row.estate_id || null,
    home_id: row.home_id || null,
    owner_id: row.owner_id || null,
    status,
    media_mode: row.media_mode,
    viewer_count: viewerCount,
    started_at: row.started_at || null,
    ended_at: row.ended_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    is_live: status === "live",
    has_guest: Boolean(session?.guestSocketId),
    guest_user_id: session?.guestUserId || null,
    guest_display_name: session?.guestDisplayName || null,
    pending_request_count: session?.pendingRequests.size || 0,
  };
}

function communityPatch(row: PersistedSession) {
  return {
    post_id: row.scope_id,
    estate_id: row.estate_id || null,
    host_user_id: row.owner_id || null,
    status: row.status,
    viewer_count: row.viewer_count,
    started_at: row.started_at || null,
    ended_at: row.ended_at || null,
    updated_at: row.updated_at || nowIso(),
  };
}

async function persistCommunitySession(row: PersistedSession) {
  if (row.surface !== "community" || row.scope_type !== "community_post") return row;
  const { data, error } = await supabaseAdmin
    .from("community_live_sessions")
    .upsert(communityPatch(row), { onConflict: "post_id" })
    .select("*")
    .maybeSingle();

  if (error) {
    if (!isMissingLiveTable(error)) {
      console.warn("community live session persist failed:", error);
    }
    return row;
  }

  if (data?.post_id) {
    return {
      ...row,
      estate_id: (data as any).estate_id || row.estate_id || null,
      owner_id: (data as any).host_user_id || row.owner_id || null,
      status: ((data as any).status || row.status) as CommunicationStatus,
      viewer_count: Number((data as any).viewer_count ?? row.viewer_count ?? 0),
      started_at: (data as any).started_at || row.started_at || null,
      ended_at: (data as any).ended_at || row.ended_at || null,
      created_at: (data as any).created_at || row.created_at || null,
      updated_at: (data as any).updated_at || row.updated_at || null,
    };
  }

  return row;
}

async function upsertPersisted(sessionId: string, patch: Partial<PersistedSession>) {
  const key = String(sessionId || "");
  const previous = persisted.get(key);
  const currentRuntime = runtime.get(key);
  const next: PersistedSession = {
    session_id: key,
    surface: patch.surface || previous?.surface || "community",
    purpose: String(patch.purpose || previous?.purpose || "live_session"),
    scope_type: patch.scope_type || previous?.scope_type || "community_post",
    scope_id: String(patch.scope_id || previous?.scope_id || key),
    estate_id: patch.estate_id !== undefined ? patch.estate_id : previous?.estate_id || null,
    home_id: patch.home_id !== undefined ? patch.home_id : previous?.home_id || null,
    owner_id: patch.owner_id !== undefined ? patch.owner_id : previous?.owner_id || null,
    status: (patch.status || previous?.status || "starting") as CommunicationStatus,
    media_mode: patch.media_mode || previous?.media_mode || "audio_video",
    viewer_count: Number(
      patch.viewer_count ??
        (currentRuntime
          ? Array.from(currentRuntime.viewerSockets).filter((socketId) => socketId !== currentRuntime.guestSocketId).length
          : previous?.viewer_count ?? 0)
    ),
    started_at: patch.started_at !== undefined ? patch.started_at : previous?.started_at || null,
    ended_at: patch.ended_at !== undefined ? patch.ended_at : previous?.ended_at || null,
    created_at: previous?.created_at || patch.created_at || nowIso(),
    updated_at: patch.updated_at || nowIso(),
  };

  const persistedRow = await persistCommunitySession(next);
  persisted.set(key, persistedRow);
  return persistedRow;
}

function recordEvent(event: Omit<CommunicationEvent, "event_id" | "created_at">) {
  const next: CommunicationEvent = {
    ...event,
    event_id: `${Date.now()}-${randomBytes(4).toString("hex")}`,
    created_at: nowIso(),
  };
  events.push(next);
  if (events.length > 500) events.splice(0, events.length - 500);
  return next;
}

export class CommunicationsLiveService {
  static async init() {
    if (!initPromise) {
      initPromise = (async () => {
        const { data, error } = await supabaseAdmin
          .from("community_live_sessions")
          .select("*")
          .in("status", ["starting", "live"]);

        if (error) {
          if (!isMissingLiveTable(error)) {
            console.warn("community live session init failed:", error);
          }
          return;
        }

        for (const row of data || []) {
          const postId = String((row as any)?.post_id || "");
          if (!postId) continue;
          persisted.set(postId, {
            session_id: postId,
            surface: "community",
            purpose: "community_live",
            scope_type: "community_post",
            scope_id: postId,
            estate_id: (row as any).estate_id || null,
            owner_id: (row as any).host_user_id || null,
            status: ((row as any).status || "starting") as CommunicationStatus,
            media_mode: "audio_video",
            viewer_count: Number((row as any).viewer_count || 0),
            started_at: (row as any).started_at || null,
            ended_at: (row as any).ended_at || null,
            created_at: (row as any).created_at || null,
            updated_at: (row as any).updated_at || null,
          });
          runtimeSession(postId);
        }
      })();
    }

    await initPromise;
  }

  static get(sessionId: string) {
    return serialize(sessionId);
  }

  static listEvents(sessionId: string) {
    return events.filter((event) => event.session_id === sessionId);
  }

  static getPendingRequests(sessionId: string) {
    return Array.from(runtimeSession(sessionId).pendingRequests.values());
  }

  static listChatMessages(sessionId: string) {
    return [...runtimeSession(sessionId).chatMessages];
  }

  static audienceSocketIds(sessionId: string) {
    const entry = runtimeSession(sessionId);
    return Array.from(entry.viewerSockets).filter((socketId) => socketId !== entry.guestSocketId);
  }

  static guestAudienceSocketIds(sessionId: string) {
    const entry = runtimeSession(sessionId);
    const ids = new Set<string>();
    if (entry.hostSocketId) ids.add(entry.hostSocketId);
    for (const socketId of entry.viewerSockets) {
      if (socketId !== entry.guestSocketId) ids.add(socketId);
    }
    return Array.from(ids);
  }

  static publisherSocketIds(sessionId: string) {
    const entry = runtimeSession(sessionId);
    return [entry.hostSocketId, entry.guestSocketId].filter(Boolean) as string[];
  }

  static hostSocketId(sessionId: string) {
    return runtime.get(String(sessionId || ""))?.hostSocketId || null;
  }

  static hostUserId(sessionId: string) {
    return persisted.get(String(sessionId || ""))?.owner_id || null;
  }

  static async start(input: CommunicationSessionCreateInput) {
    const entry = runtimeSession(input.sessionId);
    entry.viewerSockets.clear();
    entry.pendingRequests.clear();
    entry.hostSocketId = null;
    entry.guestSocketId = null;
    entry.guestUserId = null;
    entry.guestDisplayName = null;
    entry.chatMessages = [];

    await upsertPersisted(input.sessionId, {
      session_id: String(input.sessionId),
      surface: input.surface,
      purpose: input.purpose,
      scope_type: input.scopeType,
      scope_id: String(input.scopeId),
      estate_id: input.estateId || null,
      home_id: input.homeId || null,
      owner_id: input.ownerId || null,
      status: "starting",
      media_mode: input.mediaMode || "audio_video",
      viewer_count: 0,
      started_at: nowIso(),
      ended_at: null,
      updated_at: nowIso(),
    });

    recordEvent({
      session_id: input.sessionId,
      surface: input.surface,
      event_type: "session.started",
      actor_id: input.ownerId || null,
      metadata: { scope_type: input.scopeType, scope_id: input.scopeId, purpose: input.purpose },
    });

    return serialize(input.sessionId);
  }

  static async bindHost(sessionId: string, socketId: string, actorId?: string | null) {
    const entry = runtimeSession(sessionId);
    entry.hostSocketId = socketId;
    entry.viewerSockets.delete(socketId);
    const row = await upsertPersisted(sessionId, {
      status: "live",
      viewer_count: this.audienceSocketIds(sessionId).length,
      ended_at: null,
      updated_at: nowIso(),
    });
    recordEvent({
      session_id: sessionId,
      surface: row.surface,
      event_type: "participant.joined",
      actor_id: actorId || row.owner_id || null,
      metadata: { role: "host", socket_id: socketId },
    });
    return serialize(sessionId);
  }

  static async addViewer(sessionId: string, socketId: string, actorId?: string | null) {
    const existing = persisted.get(String(sessionId || ""));
    if (!existing || existing.status === "ended") return null;
    const entry = runtimeSession(sessionId);
    entry.viewerSockets.add(socketId);
    const row = await upsertPersisted(sessionId, {
      viewer_count: this.audienceSocketIds(sessionId).length,
      updated_at: nowIso(),
    });
    recordEvent({
      session_id: sessionId,
      surface: row.surface,
      event_type: "participant.joined",
      actor_id: actorId || null,
      metadata: { role: "viewer", socket_id: socketId },
    });
    return serialize(sessionId);
  }

  static async removeViewer(sessionId: string, socketId: string) {
    const entry = runtime.get(String(sessionId || ""));
    if (!entry) return serialize(sessionId);
    entry.viewerSockets.delete(socketId);
    entry.pendingRequests.delete(socketId);
    const row = await upsertPersisted(sessionId, {
      viewer_count: this.audienceSocketIds(sessionId).length,
      updated_at: nowIso(),
    });
    recordEvent({
      session_id: sessionId,
      surface: row.surface,
      event_type: "participant.left",
      metadata: { socket_id: socketId },
    });
    return serialize(sessionId);
  }

  static async requestGuest(input: { sessionId: string; socketId: string; userId?: string | null; userName?: string | null }) {
    const existing = persisted.get(String(input.sessionId || ""));
    if (!existing || existing.status === "ended") return { session: serialize(input.sessionId), requests: [] };
    const entry = runtimeSession(input.sessionId);
    if (entry.guestSocketId && entry.guestSocketId !== input.socketId) {
      return { session: serialize(input.sessionId), requests: this.getPendingRequests(input.sessionId), blocked: true };
    }
    entry.pendingRequests.set(String(input.socketId), {
      socketId: String(input.socketId),
      userId: String(input.userId || ""),
      userName: String(input.userName || "Resident"),
    });
    recordEvent({
      session_id: input.sessionId,
      surface: existing.surface,
      event_type: "guest.requested",
      actor_id: input.userId || null,
      metadata: { socket_id: input.socketId },
    });
    return {
      session: serialize(input.sessionId),
      requests: this.getPendingRequests(input.sessionId),
    };
  }

  static addChatMessage(input: {
    sessionId: string;
    userId?: string | null;
    userName?: string | null;
    text?: string | null;
  }) {
    const sessionId = String(input.sessionId || "");
    const text = String(input.text || "").trim();
    if (!sessionId || !text) return null;
    const row = persisted.get(sessionId);
    const entry = runtimeSession(sessionId);
    const message: CommunicationChatMessage = {
      id: `${Date.now()}-${randomBytes(4).toString("hex")}`,
      sessionId,
      userId: String(input.userId || ""),
      userName: String(input.userName || "Resident"),
      text,
      createdAt: nowIso(),
    };
    entry.chatMessages = [...entry.chatMessages.slice(-29), message];
    if (row) {
      recordEvent({
        session_id: sessionId,
        surface: row.surface,
        event_type: "chat.sent",
        actor_id: input.userId || null,
      });
    }
    return message;
  }

  static async approveGuest(sessionId: string, socketId: string, actorId?: string | null) {
    const row = persisted.get(String(sessionId || ""));
    const entry = runtimeSession(sessionId);
    const request = entry.pendingRequests.get(String(socketId));
    if (!request) {
      return { approved: null, session: serialize(sessionId), requests: this.getPendingRequests(sessionId) };
    }
    entry.pendingRequests.delete(String(socketId));
    if (row) {
      recordEvent({
        session_id: sessionId,
        surface: row.surface,
        event_type: "guest.approved",
        actor_id: actorId || null,
        target_id: request.userId || null,
      });
    }
    return {
      approved: request,
      audienceSocketIds: this.guestAudienceSocketIds(sessionId),
      session: serialize(sessionId),
      requests: this.getPendingRequests(sessionId),
    };
  }

  static async rejectGuest(sessionId: string, socketId: string, actorId?: string | null) {
    const row = persisted.get(String(sessionId || ""));
    const entry = runtimeSession(sessionId);
    const request = entry.pendingRequests.get(String(socketId)) || null;
    entry.pendingRequests.delete(String(socketId));
    if (row) {
      recordEvent({
        session_id: sessionId,
        surface: row.surface,
        event_type: "guest.rejected",
        actor_id: actorId || null,
        target_id: request?.userId || null,
      });
    }
    return {
      rejected: request,
      session: serialize(sessionId),
      requests: this.getPendingRequests(sessionId),
    };
  }

  static async bindGuest(input: { sessionId: string; socketId: string; userId?: string | null; userName?: string | null }) {
    const row = persisted.get(String(input.sessionId || ""));
    const entry = runtimeSession(input.sessionId);
    entry.guestSocketId = String(input.socketId);
    entry.guestUserId = String(input.userId || "");
    entry.guestDisplayName = String(input.userName || "Guest");
    entry.viewerSockets.add(String(input.socketId));
    entry.pendingRequests.delete(String(input.socketId));
    await upsertPersisted(input.sessionId, {
      status: "live",
      viewer_count: this.audienceSocketIds(input.sessionId).length,
      updated_at: nowIso(),
    });
    if (row) {
      recordEvent({
        session_id: input.sessionId,
        surface: row.surface,
        event_type: "participant.joined",
        actor_id: input.userId || null,
        metadata: { role: "guest", socket_id: input.socketId },
      });
    }
    return {
      session: serialize(input.sessionId),
      audienceSocketIds: this.guestAudienceSocketIds(input.sessionId),
    };
  }

  static async removeGuest(sessionId: string, socketId?: string | null, actorId?: string | null) {
    const row = persisted.get(String(sessionId || ""));
    const entry = runtime.get(String(sessionId || ""));
    if (!entry) return serialize(sessionId);
    if (socketId && entry.guestSocketId && entry.guestSocketId !== socketId) {
      return serialize(sessionId);
    }
    const guestSocketId = entry.guestSocketId;
    entry.guestSocketId = null;
    entry.guestUserId = null;
    entry.guestDisplayName = null;
    if (guestSocketId) {
      entry.viewerSockets.delete(guestSocketId);
      entry.pendingRequests.delete(guestSocketId);
    }
    await upsertPersisted(sessionId, {
      viewer_count: this.audienceSocketIds(sessionId).length,
      updated_at: nowIso(),
    });
    if (row) {
      recordEvent({
        session_id: sessionId,
        surface: row.surface,
        event_type: "guest.removed",
        actor_id: actorId || null,
        metadata: { socket_id: guestSocketId || null },
      });
    }
    return serialize(sessionId);
  }

  static async stop(sessionId: string, actorId?: string | null) {
    const entry = runtimeSession(sessionId);
    entry.viewerSockets.clear();
    entry.pendingRequests.clear();
    entry.hostSocketId = null;
    entry.guestSocketId = null;
    entry.guestUserId = null;
    entry.guestDisplayName = null;
    const row = await upsertPersisted(sessionId, {
      status: "ended",
      viewer_count: 0,
      ended_at: nowIso(),
      updated_at: nowIso(),
    });
    recordEvent({
      session_id: sessionId,
      surface: row.surface,
      event_type: "session.ended",
      actor_id: actorId || null,
    });
    return serialize(sessionId);
  }

  static async detachSocket(socketId: string) {
    const impacted: Array<{
      sessionId: string;
      session: CommunicationSession | null;
      ended: boolean;
      guestLeft: boolean;
      requests: CommunicationGuestRequest[];
    }> = [];

    for (const [sessionId, entry] of runtime.entries()) {
      let changed = false;
      let ended = false;
      let guestLeft = false;

      if (entry.hostSocketId === socketId) {
        entry.hostSocketId = null;
        entry.viewerSockets.clear();
        entry.pendingRequests.clear();
        entry.guestSocketId = null;
        entry.guestUserId = null;
        entry.guestDisplayName = null;
        changed = true;
        ended = true;
        await upsertPersisted(sessionId, {
          status: "ended",
          viewer_count: 0,
          ended_at: nowIso(),
          updated_at: nowIso(),
        });
      } else {
        if (entry.guestSocketId === socketId) {
          entry.guestSocketId = null;
          entry.guestUserId = null;
          entry.guestDisplayName = null;
          entry.viewerSockets.delete(socketId);
          entry.pendingRequests.delete(socketId);
          changed = true;
          guestLeft = true;
        }
        if (entry.viewerSockets.has(socketId)) {
          entry.viewerSockets.delete(socketId);
          entry.pendingRequests.delete(socketId);
          changed = true;
        }
        if (entry.pendingRequests.has(socketId)) {
          entry.pendingRequests.delete(socketId);
          changed = true;
        }
        if (changed && !ended) {
          await upsertPersisted(sessionId, {
            viewer_count: this.audienceSocketIds(sessionId).length,
            updated_at: nowIso(),
          });
        }
      }

      if (changed) {
        impacted.push({
          sessionId,
          session: serialize(sessionId),
          ended,
          guestLeft,
          requests: this.getPendingRequests(sessionId),
        });
      }
    }

    return impacted;
  }
}
