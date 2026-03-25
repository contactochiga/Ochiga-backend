import { supabaseAdmin } from "../supabase/supabaseClient";

type LiveStatus = "starting" | "live" | "ended";

type PersistedSession = {
  post_id: string;
  estate_id: string;
  host_user_id: string;
  status: LiveStatus;
  viewer_count: number;
  started_at?: string | null;
  ended_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type GuestRequest = {
  socketId: string;
  userId: string;
  userName: string;
};

type RuntimeSession = {
  postId: string;
  hostSocketId: string | null;
  viewerSockets: Set<string>;
  guestSocketId: string | null;
  guestUserId: string | null;
  guestDisplayName: string | null;
  pendingRequests: Map<string, GuestRequest>;
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

const persisted = new Map<string, PersistedSession>();
const runtime = new Map<string, RuntimeSession>();
let initPromise: Promise<void> | null = null;

function nowIso() {
  return new Date().toISOString();
}

function isMissingLiveTable(error: any) {
  const msg = String(error?.message || error || "").toLowerCase();
  return msg.includes("community_live_sessions") && msg.includes("could not find");
}

function runtimeSession(postId: string) {
  const key = String(postId || "");
  let entry = runtime.get(key);
  if (!entry) {
    entry = {
      postId: key,
      hostSocketId: null,
      viewerSockets: new Set<string>(),
      guestSocketId: null,
      guestUserId: null,
      guestDisplayName: null,
      pendingRequests: new Map<string, GuestRequest>(),
    };
    runtime.set(key, entry);
  }
  return entry;
}

function serialize(postId: string) {
  const row = persisted.get(String(postId || ""));
  if (!row) return null;
  const session = runtime.get(String(postId || ""));
  const viewerCount = session
    ? Array.from(session.viewerSockets).filter((socketId) => socketId !== session.guestSocketId).length
    : Number(row.viewer_count || 0);
  const status: LiveStatus =
    row.status === "live" || row.status === "starting" || row.status === "ended"
      ? row.status
      : "ended";
  return {
    post_id: row.post_id,
    estate_id: row.estate_id,
    host_user_id: row.host_user_id,
    status,
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
  } satisfies CommunityLiveSession;
}

async function upsertPersisted(postId: string, patch: Partial<PersistedSession>) {
  const key = String(postId || "");
  const previous = persisted.get(key);
  const currentRuntime = runtime.get(key);
  const next: PersistedSession = {
    post_id: key,
    estate_id: String(patch.estate_id || previous?.estate_id || ""),
    host_user_id: String(patch.host_user_id || previous?.host_user_id || ""),
    status: (patch.status || previous?.status || "starting") as LiveStatus,
    viewer_count: Number(
      patch.viewer_count ??
        (currentRuntime
          ? Array.from(currentRuntime.viewerSockets).filter((socketId) => socketId !== currentRuntime.guestSocketId)
              .length
          : previous?.viewer_count ?? 0)
    ),
    started_at:
      patch.started_at !== undefined ? patch.started_at : previous?.started_at || null,
    ended_at: patch.ended_at !== undefined ? patch.ended_at : previous?.ended_at || null,
    created_at: previous?.created_at || patch.created_at || nowIso(),
    updated_at: patch.updated_at || nowIso(),
  };

  persisted.set(key, next);

  const { data, error } = await supabaseAdmin
    .from("community_live_sessions")
    .upsert(next, { onConflict: "post_id" })
    .select("*")
    .maybeSingle();

  if (error) {
    if (!isMissingLiveTable(error)) {
      console.warn("community live session persist failed:", error);
    }
    return next;
  }

  if (data?.post_id) {
    persisted.set(key, data as PersistedSession);
    return data as PersistedSession;
  }

  return next;
}

function parseJsonArray(value: string | undefined) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function splitList(value: string | undefined) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export class CommunityLiveService {
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
          persisted.set(postId, row as PersistedSession);
          runtimeSession(postId);
        }
      })();
    }

    await initPromise;
  }

  static get(postId: string) {
    return serialize(postId);
  }

  static getPendingRequests(postId: string) {
    return Array.from(runtimeSession(postId).pendingRequests.values());
  }

  static audienceSocketIds(postId: string) {
    const entry = runtimeSession(postId);
    return Array.from(entry.viewerSockets).filter((socketId) => socketId !== entry.guestSocketId);
  }

  static guestAudienceSocketIds(postId: string) {
    const entry = runtimeSession(postId);
    const ids = new Set<string>();
    if (entry.hostSocketId) ids.add(entry.hostSocketId);
    for (const socketId of entry.viewerSockets) {
      if (socketId !== entry.guestSocketId) ids.add(socketId);
    }
    return Array.from(ids);
  }

  static publisherSocketIds(postId: string) {
    const entry = runtimeSession(postId);
    return [entry.hostSocketId, entry.guestSocketId].filter(Boolean) as string[];
  }

  static async start(input: { postId: string; estateId: string; hostUserId: string }) {
    const entry = runtimeSession(input.postId);
    entry.viewerSockets.clear();
    entry.pendingRequests.clear();
    entry.hostSocketId = null;
    entry.guestSocketId = null;
    entry.guestUserId = null;
    entry.guestDisplayName = null;

    await upsertPersisted(input.postId, {
      post_id: String(input.postId),
      estate_id: String(input.estateId),
      host_user_id: String(input.hostUserId),
      status: "starting",
      viewer_count: 0,
      started_at: nowIso(),
      ended_at: null,
      updated_at: nowIso(),
    });

    return serialize(input.postId);
  }

  static async bindHost(postId: string, socketId: string) {
    const entry = runtimeSession(postId);
    entry.hostSocketId = socketId;
    entry.viewerSockets.delete(socketId);
    await upsertPersisted(postId, {
      status: "live",
      viewer_count: this.audienceSocketIds(postId).length,
      ended_at: null,
      updated_at: nowIso(),
    });
    return serialize(postId);
  }

  static async addViewer(postId: string, socketId: string) {
    const existing = persisted.get(String(postId || ""));
    if (!existing || existing.status === "ended") return null;
    const entry = runtimeSession(postId);
    entry.viewerSockets.add(socketId);
    await upsertPersisted(postId, {
      viewer_count: this.audienceSocketIds(postId).length,
      updated_at: nowIso(),
    });
    return serialize(postId);
  }

  static async removeViewer(postId: string, socketId: string) {
    const entry = runtime.get(String(postId || ""));
    if (!entry) return serialize(postId);
    entry.viewerSockets.delete(socketId);
    entry.pendingRequests.delete(socketId);
    await upsertPersisted(postId, {
      viewer_count: this.audienceSocketIds(postId).length,
      updated_at: nowIso(),
    });
    return serialize(postId);
  }

  static async requestGuest(input: { postId: string; socketId: string; userId?: string | null; userName?: string | null }) {
    const existing = persisted.get(String(input.postId || ""));
    if (!existing || existing.status === "ended") return { session: serialize(input.postId), requests: [] };
    const entry = runtimeSession(input.postId);
    if (entry.guestSocketId && entry.guestSocketId !== input.socketId) {
      return { session: serialize(input.postId), requests: this.getPendingRequests(input.postId), blocked: true };
    }
    entry.pendingRequests.set(String(input.socketId), {
      socketId: String(input.socketId),
      userId: String(input.userId || ""),
      userName: String(input.userName || "Resident"),
    });
    return {
      session: serialize(input.postId),
      requests: this.getPendingRequests(input.postId),
    };
  }

  static async approveGuest(postId: string, socketId: string) {
    const entry = runtimeSession(postId);
    const request = entry.pendingRequests.get(String(socketId));
    if (!request) {
      return { approved: null, session: serialize(postId), requests: this.getPendingRequests(postId) };
    }
    entry.pendingRequests.delete(String(socketId));
    return {
      approved: request,
      audienceSocketIds: this.guestAudienceSocketIds(postId),
      session: serialize(postId),
      requests: this.getPendingRequests(postId),
    };
  }

  static async rejectGuest(postId: string, socketId: string) {
    const entry = runtimeSession(postId);
    const request = entry.pendingRequests.get(String(socketId)) || null;
    entry.pendingRequests.delete(String(socketId));
    return {
      rejected: request,
      session: serialize(postId),
      requests: this.getPendingRequests(postId),
    };
  }

  static async bindGuest(input: { postId: string; socketId: string; userId?: string | null; userName?: string | null }) {
    const entry = runtimeSession(input.postId);
    entry.guestSocketId = String(input.socketId);
    entry.guestUserId = String(input.userId || "");
    entry.guestDisplayName = String(input.userName || "Guest");
    entry.viewerSockets.add(String(input.socketId));
    entry.pendingRequests.delete(String(input.socketId));
    await upsertPersisted(input.postId, {
      status: "live",
      viewer_count: this.audienceSocketIds(input.postId).length,
      updated_at: nowIso(),
    });
    return {
      session: serialize(input.postId),
      audienceSocketIds: this.guestAudienceSocketIds(input.postId),
    };
  }

  static async removeGuest(postId: string, socketId?: string | null) {
    const entry = runtime.get(String(postId || ""));
    if (!entry) return serialize(postId);
    if (socketId && entry.guestSocketId && entry.guestSocketId !== socketId) {
      return serialize(postId);
    }
    const guestSocketId = entry.guestSocketId;
    entry.guestSocketId = null;
    entry.guestUserId = null;
    entry.guestDisplayName = null;
    if (guestSocketId) {
      entry.viewerSockets.delete(guestSocketId);
      entry.pendingRequests.delete(guestSocketId);
    }
    await upsertPersisted(postId, {
      viewer_count: this.audienceSocketIds(postId).length,
      updated_at: nowIso(),
    });
    return serialize(postId);
  }

  static async stop(postId: string) {
    const entry = runtimeSession(postId);
    entry.viewerSockets.clear();
    entry.pendingRequests.clear();
    entry.hostSocketId = null;
    entry.guestSocketId = null;
    entry.guestUserId = null;
    entry.guestDisplayName = null;
    await upsertPersisted(postId, {
      status: "ended",
      viewer_count: 0,
      ended_at: nowIso(),
      updated_at: nowIso(),
    });
    return serialize(postId);
  }

  static hostSocketId(postId: string) {
    return runtime.get(String(postId || ""))?.hostSocketId || null;
  }

  static async detachSocket(socketId: string) {
    const impacted: Array<{
      postId: string;
      session: CommunityLiveSession | null;
      ended: boolean;
      guestLeft: boolean;
      requests: GuestRequest[];
    }> = [];

    for (const [postId, entry] of runtime.entries()) {
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
        await upsertPersisted(postId, {
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
          await upsertPersisted(postId, {
            viewer_count: this.audienceSocketIds(postId).length,
            updated_at: nowIso(),
          });
        }
      }

      if (changed) {
        impacted.push({
          postId,
          session: serialize(postId),
          ended,
          guestLeft,
          requests: this.getPendingRequests(postId),
        });
      }
    }

    return impacted;
  }

  static async rtcConfig() {
    const twilioAccountSid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
    const twilioAuthToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
    if (twilioAccountSid && twilioAuthToken) {
      try {
        const ttl = Math.max(300, Math.min(Number(process.env.LIVE_TWILIO_TTL || 3600), 86400));
        const body = new URLSearchParams();
        body.set("Ttl", String(ttl));

        const response = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioAccountSid)}/Tokens.json`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString("base64")}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
          }
        );

        if (response.ok) {
          const data: any = await response.json();
          if (Array.isArray(data?.ice_servers) && data.ice_servers.length) {
            return {
              iceServers: data.ice_servers,
              iceTransportPolicy: process.env.LIVE_FORCE_RELAY === "true" ? "relay" : "all",
            };
          }
        } else {
          const text = await response.text();
          console.warn("twilio rtc config request failed:", response.status, text);
        }
      } catch (error) {
        console.warn("twilio rtc config request failed:", error);
      }
    }

    const direct = parseJsonArray(process.env.LIVE_ICE_SERVERS_JSON);
    if (direct?.length) {
      return {
        iceServers: direct,
        iceTransportPolicy: process.env.LIVE_FORCE_RELAY === "true" ? "relay" : "all",
      };
    }

    const stunUrls = splitList(process.env.LIVE_STUN_URLS);
    const turnUrls = splitList(process.env.LIVE_TURN_URLS || process.env.LIVE_TURN_URL);
    const iceServers: Array<Record<string, any>> = [];

    const effectiveStun = stunUrls.length ? stunUrls : ["stun:stun.l.google.com:19302"];
    if (effectiveStun.length) {
      iceServers.push({ urls: effectiveStun });
    }

    if (turnUrls.length) {
      iceServers.push({
        urls: turnUrls,
        username: process.env.LIVE_TURN_USERNAME || "",
        credential: process.env.LIVE_TURN_CREDENTIAL || "",
      });
    }

    return {
      iceServers,
      iceTransportPolicy: process.env.LIVE_FORCE_RELAY === "true" ? "relay" : "all",
    };
  }
}
