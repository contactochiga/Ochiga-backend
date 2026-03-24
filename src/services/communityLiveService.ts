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

type RuntimeSession = {
  postId: string;
  hostSocketId: string | null;
  viewerSockets: Set<string>;
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
    };
    runtime.set(key, entry);
  }
  return entry;
}

function serialize(postId: string) {
  const row = persisted.get(String(postId || ""));
  if (!row) return null;
  const session = runtime.get(String(postId || ""));
  const viewerCount = session ? session.viewerSockets.size : Number(row.viewer_count || 0);
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
  } satisfies CommunityLiveSession;
}

async function upsertPersisted(postId: string, patch: Partial<PersistedSession>) {
  const key = String(postId || "");
  const previous = persisted.get(key);
  const next: PersistedSession = {
    post_id: key,
    estate_id: String(patch.estate_id || previous?.estate_id || ""),
    host_user_id: String(patch.host_user_id || previous?.host_user_id || ""),
    status: (patch.status || previous?.status || "starting") as LiveStatus,
    viewer_count: Number(patch.viewer_count ?? previous?.viewer_count ?? 0),
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

  static async start(input: { postId: string; estateId: string; hostUserId: string }) {
    const runtimeEntry = runtimeSession(input.postId);
    runtimeEntry.viewerSockets.clear();
    runtimeEntry.hostSocketId = null;

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
    await upsertPersisted(postId, {
      status: "live",
      viewer_count: entry.viewerSockets.size,
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
      viewer_count: entry.viewerSockets.size,
      updated_at: nowIso(),
    });
    return serialize(postId);
  }

  static async removeViewer(postId: string, socketId: string) {
    const entry = runtime.get(String(postId || ""));
    if (!entry) return serialize(postId);
    entry.viewerSockets.delete(socketId);
    await upsertPersisted(postId, {
      viewer_count: entry.viewerSockets.size,
      updated_at: nowIso(),
    });
    return serialize(postId);
  }

  static async stop(postId: string) {
    const entry = runtimeSession(postId);
    entry.viewerSockets.clear();
    entry.hostSocketId = null;
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
    const impacted: Array<{ postId: string; session: CommunityLiveSession | null; ended: boolean }> = [];

    for (const [postId, entry] of runtime.entries()) {
      let changed = false;
      let ended = false;

      if (entry.hostSocketId === socketId) {
        entry.hostSocketId = null;
        entry.viewerSockets.clear();
        changed = true;
        ended = true;
        await upsertPersisted(postId, {
          status: "ended",
          viewer_count: 0,
          ended_at: nowIso(),
          updated_at: nowIso(),
        });
      } else if (entry.viewerSockets.has(socketId)) {
        entry.viewerSockets.delete(socketId);
        changed = true;
        await upsertPersisted(postId, {
          viewer_count: entry.viewerSockets.size,
          updated_at: nowIso(),
        });
      }

      if (changed) {
        impacted.push({ postId, session: serialize(postId), ended });
      }
    }

    return impacted;
  }

  static rtcConfig() {
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
