import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { NotificationService } from "../services/NotificationService";
import { uploadToS3 } from "../services/s3Service";
import { getIO } from "../realtime/io";

const MOD_ROLES = new Set(["admin", "estate_admin", "manager", "owner", "security", "operator"]);
const PRESENCE_ONLINE_WINDOW_MS = 2 * 60 * 1000;

function clean(v: any) {
  return String(v ?? "").trim();
}

function normalizePair(a: string, b: string) {
  return a < b ? { userA: a, userB: b } : { userA: b, userB: a };
}

function isMissingTable(err: any, table: string) {
  const msg = String(err?.message || "").toLowerCase();
  return (
    msg.includes(table.toLowerCase()) &&
    (msg.includes("could not find the table") || msg.includes("relation") || msg.includes("does not exist"))
  );
}

function extFromMime(mime?: string, fallback = "bin") {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
  };
  if (mime && map[mime]) return map[mime];
  return fallback;
}

async function getUserById(userId: string) {
  return supabaseAdmin
    .from("users")
    .select("id, estate_id, home_id, username, full_name, email, role")
    .eq("id", userId)
    .maybeSingle();
}

async function getThreadById(threadId: string) {
  return supabaseAdmin
    .from("dm_threads")
    .select("*")
    .eq("id", threadId)
    .maybeSingle();
}

async function getMember(threadId: string, userId: string) {
  return supabaseAdmin
    .from("dm_thread_members")
    .select("*")
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
}

function requestScope(req: Request, user: any) {
  return {
    estateId: clean((req as any).oisContext?.estate_id || req.query?.estate_id || req.body?.estate_id || user?.estate_id),
    homeId: clean((req as any).oisContext?.home_id || req.query?.home_id || req.body?.home_id || user?.home_id),
  };
}

async function assertActiveHomeMembership(userId: string, estateId: string, homeId: string) {
  if (!homeId) return null;
  const { data: home, error: homeErr } = await supabaseAdmin
    .from("homes")
    .select("id, estate_id")
    .eq("id", homeId)
    .maybeSingle();
  if (homeErr) throw new Error(homeErr.message);
  if (!home?.id || (estateId && String(home.estate_id) !== String(estateId))) {
    const err = Object.assign(new Error("Home is not available in this estate"), { statusCode: 403 });
    throw err;
  }
  const { data, error } = await supabaseAdmin
    .from("home_memberships")
    .select("id, role, status")
    .eq("home_id", homeId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) {
    const err = Object.assign(new Error("You do not have access to this home"), { statusCode: 403 });
    throw err;
  }
  return data;
}

async function userIdsForHome(homeId: string) {
  const { data, error } = await supabaseAdmin
    .from("home_memberships")
    .select("user_id")
    .eq("home_id", homeId)
    .eq("status", "active");
  if (error) throw new Error(error.message);
  return new Set((data || []).map((row: any) => clean(row.user_id)).filter(Boolean));
}

async function assertThreadInActiveScope(req: Request, user: any, thread: any) {
  const { estateId, homeId } = requestScope(req, user);
  if (estateId && String(thread?.estate_id || "") !== estateId) {
    const err = Object.assign(new Error("Thread is outside the selected estate"), { statusCode: 403 });
    throw err;
  }
  if (homeId) {
    const threadHomeId = clean(thread?.home_id);
    if (threadHomeId && threadHomeId !== homeId) {
      const err = Object.assign(new Error("Thread is outside the selected home"), { statusCode: 403 });
      throw err;
    }
    await assertActiveHomeMembership(String(user.id), estateId || clean(thread?.estate_id), homeId);
  }
}

async function ensureMessageTables(res: Response) {
  const { error } = await supabaseAdmin.from("dm_threads").select("id").limit(1);
  if (!error) return true;
  if (isMissingTable(error, "dm_threads")) {
    res.status(503).json({
      error: "Messaging tables are not ready. Run latest DB migration.",
      code: "MESSAGING_TABLES_MISSING",
    });
    return false;
  }
  res.status(500).json({ error: error.message });
  return false;
}

async function touchPresence(user: any, req?: Request) {
  if (!user?.id) return;
  const scope = req ? requestScope(req, user) : { estateId: clean(user.estate_id), homeId: clean(user.home_id) };

  const payload = {
    user_id: String(user.id),
    estate_id: scope.estateId || null,
    home_id: scope.homeId || null,
    last_seen_at: new Date().toISOString(),
    is_online: true,
    updated_at: new Date().toISOString(),
  };

  let error: any = null;
  if (scope.homeId) {
    ({ error } = await supabaseAdmin
      .from("user_presence")
      .upsert(payload as any, { onConflict: "user_id,home_id" }));
  } else {
    const existing = await supabaseAdmin
      .from("user_presence")
      .select("id")
      .eq("user_id", String(user.id))
      .is("home_id", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing.error && !isMissingTable(existing.error, "user_presence")) {
      error = existing.error;
    } else if (existing.data?.id) {
      const updateResult = await supabaseAdmin
        .from("user_presence")
        .update(payload as any)
        .eq("id", String((existing.data as any).id));
      error = updateResult.error;
    } else {
      ({ error } = await supabaseAdmin.from("user_presence").insert(payload as any));
    }
  }

  if (error && !isMissingTable(error, "user_presence")) {
    if (!/duplicate key/i.test(String(error.message || ""))) console.warn("touchPresence failed:", error.message);
  }
}

async function getPresenceMap(userIds: string[], homeId?: string | null) {
  const cleanIds = Array.from(new Set(userIds.map((x) => clean(x)).filter(Boolean)));
  if (!cleanIds.length) return {} as Record<string, { last_seen_at: string | null; is_online: boolean }>;

  let query = supabaseAdmin
    .from("user_presence")
    .select("user_id,last_seen_at,is_online")
    .in("user_id", cleanIds);
  const scopedHomeId = clean(homeId);
  query = scopedHomeId ? query.eq("home_id", scopedHomeId) : query.is("home_id", null);
  const { data, error } = await query;

  if (error) {
    if (!isMissingTable(error, "user_presence")) {
      console.warn("getPresenceMap failed:", error.message);
    }
    return {} as Record<string, { last_seen_at: string | null; is_online: boolean }>;
  }

  const now = Date.now();
  return Object.fromEntries(
    (data || []).map((row: any) => {
      const lastSeen = row?.last_seen_at ? String(row.last_seen_at) : null;
      const isFresh = lastSeen ? now - new Date(lastSeen).getTime() <= PRESENCE_ONLINE_WINDOW_MS : false;
      return [
        String(row.user_id),
        {
          last_seen_at: lastSeen,
          is_online: Boolean(row?.is_online) && isFresh,
        },
      ];
    })
  );
}

export async function listResidents(req: Request, res: Response) {
  const user = req.user as any;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });
  const { estateId, homeId } = requestScope(req, user);
  if (!estateId) return res.status(400).json({ error: "No estate linked" });
  try {
    if (homeId) await assertActiveHomeMembership(String(user.id), estateId, homeId);
  } catch (error: any) {
    return res.status(error?.statusCode || 500).json({ error: error?.message || "Unable to resolve message scope" });
  }
  await touchPresence(user, req);

  const q = clean(req.query.q || "").toLowerCase();

  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, username, full_name, email, role, home_id")
    .eq("estate_id", estateId)
    .neq("id", user.id)
    .limit(200);

  if (error) return res.status(500).json({ error: error.message });

  let items = (data || []) as any[];
  if (homeId) {
    try {
      const scopedUsers = await userIdsForHome(homeId);
      items = items.filter((u) => scopedUsers.has(String(u.id)));
    } catch (e: any) {
      return res.status(500).json({ error: e?.message || "Failed to resolve home residents" });
    }
  }
  const presenceMap = await getPresenceMap(items.map((u) => String(u.id)), homeId);
  if (q) {
    items = items.filter((u) => {
      const src = `${u?.username || ""} ${u?.full_name || ""} ${u?.email || ""}`.toLowerCase();
      return src.includes(q);
    });
  }

  return res.json({
    residents: items.map((u) => ({
      id: String(u.id),
      username: u.username || null,
      full_name: u.full_name || null,
      role: u.role || null,
      home_id: u.home_id || null,
      is_online: Boolean(presenceMap[String(u.id)]?.is_online),
      last_seen_at: presenceMap[String(u.id)]?.last_seen_at || null,
    })),
  });
}

export async function createOrGetDirectThread(req: Request, res: Response) {
  const user = req.user as any;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });
  const { estateId, homeId } = requestScope(req, user);
  if (!estateId) return res.status(400).json({ error: "No estate linked" });
  if (!(await ensureMessageTables(res))) return;
  try {
    if (homeId) await assertActiveHomeMembership(String(user.id), estateId, homeId);
  } catch (error: any) {
    return res.status(error?.statusCode || 500).json({ error: error?.message || "Unable to resolve message scope" });
  }
  await touchPresence(user, req);

  const peerUserId = clean(req.body?.peer_user_id);
  if (!peerUserId) return res.status(400).json({ error: "peer_user_id is required" });
  if (peerUserId === user.id) return res.status(400).json({ error: "Cannot chat with yourself" });

  const { data: peer, error: peerErr } = await getUserById(peerUserId);
  if (peerErr) return res.status(500).json({ error: peerErr.message });
  if (!peer?.id) return res.status(404).json({ error: "Resident not found" });
  if (String(peer.estate_id) !== estateId) {
    return res.status(403).json({ error: "Resident is not in your estate" });
  }
  if (homeId) {
    const scopedUsers = await userIdsForHome(homeId);
    if (!scopedUsers.has(peerUserId)) return res.status(403).json({ error: "Resident is not in the selected home" });
  }

  const { userA, userB } = normalizePair(String(user.id), String(peerUserId));

  let existingQuery = supabaseAdmin
    .from("dm_threads")
    .select("*")
    .eq("estate_id", estateId)
    .eq("kind", "direct")
    .eq("user_a_id", userA)
    .eq("user_b_id", userB);
  existingQuery = homeId ? existingQuery.eq("home_id", homeId) : existingQuery.is("home_id", null);
  const existing = await existingQuery.maybeSingle();

  if (existing.error && !isMissingTable(existing.error, "dm_threads")) {
    return res.status(500).json({ error: existing.error.message });
  }
  if (existing.data?.id) {
    return res.json({ ok: true, thread: existing.data });
  }

  const inserted = await supabaseAdmin
    .from("dm_threads")
    .insert({
      estate_id: estateId,
      home_id: homeId || null,
      scope: homeId ? "home" : "global",
      kind: "direct",
      user_a_id: userA,
      user_b_id: userB,
      created_by: user.id,
      last_message_at: null,
    } as any)
    .select("*")
    .single();

  if (inserted.error) return res.status(500).json({ error: inserted.error.message });

  const thread = inserted.data as any;

  const membersUpsert = await supabaseAdmin.from("dm_thread_members").upsert(
    [
      { thread_id: thread.id, estate_id: estateId, home_id: homeId || null, user_id: user.id, role: "member", is_active: true },
      { thread_id: thread.id, estate_id: estateId, home_id: homeId || null, user_id: peerUserId, role: "member", is_active: true },
    ] as any,
    { onConflict: "thread_id,user_id" }
  );
  if (membersUpsert.error) return res.status(500).json({ error: membersUpsert.error.message });

  return res.json({ ok: true, thread });
}

export async function listInbox(req: Request, res: Response) {
  const user = req.user as any;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });
  if (!(await ensureMessageTables(res))) return;
  const { estateId, homeId } = requestScope(req, user);
  try {
    if (homeId) await assertActiveHomeMembership(String(user.id), estateId, homeId);
  } catch (error: any) {
    return res.status(error?.statusCode || 500).json({ error: error?.message || "Unable to resolve message scope" });
  }
  await touchPresence(user, req);

  let membershipQuery = supabaseAdmin
    .from("dm_thread_members")
    .select("thread_id,last_read_at,home_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("joined_at", { ascending: false })
    .limit(200);
  membershipQuery = homeId ? membershipQuery.eq("home_id", homeId) : membershipQuery.is("home_id", null);
  const { data: memberships, error: memErr } = await membershipQuery;

  if (memErr) return res.status(500).json({ error: memErr.message });
  const threadIds = (memberships || []).map((m: any) => String(m.thread_id));
  if (!threadIds.length) return res.json({ threads: [] });

  let threadQuery = supabaseAdmin
    .from("dm_threads")
    .select("*")
    .in("id", threadIds)
    .order("last_message_at", { ascending: false, nullsFirst: false });
  threadQuery = homeId ? threadQuery.eq("home_id", homeId) : threadQuery.is("home_id", null);
  const { data: threads, error: tErr } = await threadQuery;

  if (tErr) return res.status(500).json({ error: tErr.message });
  const scopedThreadIds = (threads || []).map((thread: any) => String(thread.id));
  if (!scopedThreadIds.length) return res.json({ threads: [] });

  const { data: latestMsgs, error: msgErr } = await supabaseAdmin
    .from("dm_messages")
    .select("id,thread_id,body,sender_id,created_at,is_hidden")
    .in("thread_id", scopedThreadIds)
    .eq("is_hidden", false)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (msgErr) return res.status(500).json({ error: msgErr.message });

  const latestByThread: Record<string, any> = {};
  for (const m of latestMsgs || []) {
    const key = String((m as any).thread_id);
    if (!latestByThread[key]) latestByThread[key] = m;
  }

  const peerIds = new Set<string>();
  for (const t of threads || []) {
    const a = clean((t as any).user_a_id);
    const b = clean((t as any).user_b_id);
    if (a && a !== user.id) peerIds.add(a);
    if (b && b !== user.id) peerIds.add(b);
  }

  let usersById: Record<string, any> = {};
  if (peerIds.size) {
    const { data: peers, error: pErr } = await supabaseAdmin
      .from("users")
      .select("id,username,full_name,role,home_id")
      .in("id", Array.from(peerIds));
    if (pErr) return res.status(500).json({ error: pErr.message });
    usersById = Object.fromEntries((peers || []).map((u: any) => [String(u.id), u]));
  }
  const presenceMap = await getPresenceMap(Array.from(peerIds));

  const memberByThread = Object.fromEntries(
    (memberships || []).map((m: any) => [String(m.thread_id), m])
  );

  const threadsOut = await Promise.all(
    (threads || []).map(async (t: any) => {
      const threadId = String(t.id);
      const m = memberByThread[threadId];
      const lastReadAt = m?.last_read_at ? new Date(String(m.last_read_at)).toISOString() : null;
      const peerId = String(t.user_a_id) === String(user.id) ? String(t.user_b_id) : String(t.user_a_id);
      const peer = usersById[peerId] || null;
      const latest = latestByThread[threadId] || null;

      let unread_count = 0;
      let q = supabaseAdmin
        .from("dm_messages")
        .select("id", { count: "exact", head: true })
        .eq("thread_id", threadId)
        .eq("is_hidden", false)
        .neq("sender_id", user.id);
      if (lastReadAt) q = q.gt("created_at", lastReadAt);
      const { count } = await q;
      unread_count = Number(count || 0);

      return {
        id: threadId,
        kind: t.kind,
        peer: peer
          ? {
              id: String(peer.id),
              username: peer.username || null,
              full_name: peer.full_name || null,
              role: peer.role || null,
              home_id: peer.home_id || null,
              is_online: Boolean(presenceMap[peerId]?.is_online),
              last_seen_at: presenceMap[peerId]?.last_seen_at || null,
            }
          : null,
        last_message: latest
          ? {
              id: latest.id,
              body: latest.body,
              sender_id: latest.sender_id,
              created_at: latest.created_at,
            }
          : null,
        unread_count,
        last_message_at: t.last_message_at || null,
      };
    })
  );

  return res.json({ threads: threadsOut });
}

export async function listThreadMessages(req: Request, res: Response) {
  const user = req.user as any;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });
  if (!(await ensureMessageTables(res))) return;
  await touchPresence(user, req);

  const threadId = clean(req.params.threadId);
  if (!threadId) return res.status(400).json({ error: "threadId is required" });

  const { data: member, error: mErr } = await getMember(threadId, user.id);
  if (mErr) return res.status(500).json({ error: mErr.message });
  if (!member?.id) return res.status(403).json({ error: "Not a member of this thread" });
  const { data: thread, error: threadErr } = await getThreadById(threadId);
  if (threadErr) return res.status(500).json({ error: threadErr.message });
  if (!thread?.id) return res.status(404).json({ error: "Thread not found" });
  try {
    await assertThreadInActiveScope(req, user, thread);
  } catch (error: any) {
    return res.status(error?.statusCode || 500).json({ error: error?.message || "Thread is outside the selected context" });
  }

  const limit = Math.max(1, Math.min(100, Number.parseInt(clean(req.query.limit), 10) || 50));
  const before = clean(req.query.before || "");

  let q = supabaseAdmin
    .from("dm_messages")
    .select("*")
    .eq("thread_id", threadId)
    .eq("is_hidden", false)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (before) q = q.lt("created_at", before);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const { data: members, error: membersErr } = await supabaseAdmin
    .from("dm_thread_members")
    .select("user_id,last_read_at")
    .eq("thread_id", threadId)
    .eq("is_active", true);

  if (membersErr) return res.status(500).json({ error: membersErr.message });

  const peerMember = (members || []).find((item: any) => String(item.user_id) !== String(user.id));
  const rows = (data || []).slice().reverse();
  return res.json({
    messages: rows,
    peer_last_read_at: peerMember?.last_read_at || null,
  });
}

export async function sendMessage(req: Request, res: Response) {
  const user = req.user as any;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });
  if (!(await ensureMessageTables(res))) return;
  await touchPresence(user, req);

  const threadId = clean(req.params.threadId);
  const body = clean(req.body?.body);
  const messageType = clean(req.body?.message_type || "text").toLowerCase();
  const metadata = typeof req.body?.metadata === "object" && req.body?.metadata ? req.body.metadata : {};
  if (!threadId) return res.status(400).json({ error: "threadId is required" });
  const mediaUrl = clean(metadata?.media_url);
  const caption = clean(metadata?.caption || body);
  if (!body && !mediaUrl) return res.status(400).json({ error: "Message body or media is required" });
  if (body.length > 2000) return res.status(400).json({ error: "Message too long (max 2000 chars)" });

  const { data: thread, error: tErr } = await getThreadById(threadId);
  if (tErr) return res.status(500).json({ error: tErr.message });
  if (!thread?.id) return res.status(404).json({ error: "Thread not found" });
  try {
    await assertThreadInActiveScope(req, user, thread);
  } catch (error: any) {
    return res.status(error?.statusCode || 403).json({ error: error?.message || "Unauthorized" });
  }

  const { data: member, error: mErr } = await getMember(threadId, user.id);
  if (mErr) return res.status(500).json({ error: mErr.message });
  if (!member?.id) return res.status(403).json({ error: "Not a member of this thread" });

  if (member.muted_until && new Date(String(member.muted_until)).getTime() > Date.now()) {
    return res.status(403).json({ error: "You are muted in this thread" });
  }

  const { data: msg, error } = await supabaseAdmin
    .from("dm_messages")
    .insert({
      thread_id: threadId,
      estate_id: thread.estate_id,
      home_id: thread.home_id || requestScope(req, user).homeId || null,
      sender_id: user.id,
      body: body || caption || null,
      message_type: ["image", "video", "file"].includes(messageType) ? messageType : "text",
      metadata,
    } as any)
    .select("*")
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await supabaseAdmin
    .from("dm_threads")
    .update({
      last_message_at: msg.created_at,
      updated_at: new Date().toISOString(),
    } as any)
    .eq("id", threadId);

  await supabaseAdmin
    .from("dm_thread_members")
    .update({ last_read_at: msg.created_at } as any)
    .eq("thread_id", threadId)
    .eq("user_id", user.id);

  const { data: recipients } = await supabaseAdmin
    .from("dm_thread_members")
    .select("user_id")
    .eq("thread_id", threadId)
    .eq("is_active", true)
    .neq("user_id", user.id);

  const senderName = clean(user.username || "");
  const title = senderName ? `New message from ${senderName}` : "New message";
  const io = getIO();
  io?.to(`thread:${threadId}`).emit("dm:new", msg);
  io?.to(`user:${user.id}`).emit("dm:new", msg);
  for (const r of recipients || []) {
    const uid = String((r as any).user_id || "");
    if (!uid) continue;
    io?.to(`user:${uid}`).emit("dm:new", msg);
    await NotificationService.sendToUser(uid, {
      title,
      message:
        msg.message_type === "image"
          ? `${senderName || "Resident"} sent an image`
          : msg.message_type === "video"
            ? `${senderName || "Resident"} sent a video`
            : body.length > 90
              ? `${body.slice(0, 90)}...`
              : body,
      type: "system",
      payload: {
        threadId,
        thread_id: threadId,
        messageId: msg.id,
        message_id: msg.id,
        kind: "chat.dm",
        estate_id: thread.estate_id || null,
        home_id: thread.home_id || requestScope(req, user).homeId || null,
      },
      routing: {
        source_type: "message",
        source_id: String(threadId),
        destination: "page",
        target: { target_type: "message", target_id: String(threadId), open_as: "page", action: "inspect" },
        actionability: "informational",
        attention_eligible: false,
        queue_eligible: false,
        acknowledgement_required: false,
      },
      entityId: String(msg.id),
    });
  }

  return res.json({ ok: true, message: msg });
}

export async function uploadMessageMedia(req: Request, res: Response) {
  const user = req.user as any;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  const { base64, mime, filename, mediaType } = req.body || {};
  if (!base64 || !mime) return res.status(400).json({ error: "base64 and mime are required" });

  let buffer: Buffer;
  try {
    const raw = String(base64);
    const cleaned = raw.includes(",") ? raw.split(",").pop() || "" : raw;
    buffer = Buffer.from(cleaned, "base64");
  } catch {
    return res.status(400).json({ error: "Invalid base64 payload" });
  }

  const ext = extFromMime(String(mime), mediaType === "video" ? "mp4" : "jpg");
  const key = `messages/${String(user.estate_id || "global")}/${String(user.id)}/${Date.now()}-${clean(filename || "media")}.${ext}`;

  try {
    const url = await uploadToS3(key, buffer, String(mime));
    return res.json({
      ok: true,
      url,
      mime: String(mime),
      mediaType: mediaType === "video" ? "video" : "image",
      key,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to upload media" });
  }
}

export async function markThreadRead(req: Request, res: Response) {
  const user = req.user as any;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });
  if (!(await ensureMessageTables(res))) return;
  await touchPresence(user, req);

  const threadId = clean(req.params.threadId);
  if (!threadId) return res.status(400).json({ error: "threadId is required" });
  const { data: thread, error: threadErr } = await getThreadById(threadId);
  if (threadErr) return res.status(500).json({ error: threadErr.message });
  if (!thread?.id) return res.status(404).json({ error: "Thread not found" });
  try {
    await assertThreadInActiveScope(req, user, thread);
  } catch (error: any) {
    return res.status(error?.statusCode || 403).json({ error: error?.message || "Thread is outside the selected context" });
  }

  const { error } = await supabaseAdmin
    .from("dm_thread_members")
    .update({ last_read_at: new Date().toISOString() } as any)
    .eq("thread_id", threadId)
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
}

export async function pingPresence(req: Request, res: Response) {
  const user = req.user as any;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  await touchPresence(user, req);
  return res.json({ ok: true, last_seen_at: new Date().toISOString() });
}

export async function reportMessage(req: Request, res: Response) {
  const user = req.user as any;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });
  if (!(await ensureMessageTables(res))) return;

  const messageId = clean(req.params.messageId);
  const reason = clean(req.body?.reason);
  const details = clean(req.body?.details);

  if (!messageId) return res.status(400).json({ error: "messageId is required" });
  if (!reason) return res.status(400).json({ error: "reason is required" });

  const { data: msg, error: msgErr } = await supabaseAdmin
    .from("dm_messages")
    .select("id,thread_id,estate_id,sender_id")
    .eq("id", messageId)
    .maybeSingle();
  if (msgErr) return res.status(500).json({ error: msgErr.message });
  if (!msg?.id) return res.status(404).json({ error: "Message not found" });

  const { data: member, error: mErr } = await getMember(String(msg.thread_id), user.id);
  if (mErr) return res.status(500).json({ error: mErr.message });
  if (!member?.id) return res.status(403).json({ error: "Not a member of this thread" });
  const { data: thread, error: threadErr } = await getThreadById(String(msg.thread_id));
  if (threadErr) return res.status(500).json({ error: threadErr.message });
  if (!thread?.id) return res.status(404).json({ error: "Thread not found" });
  try {
    await assertThreadInActiveScope(req, user, thread);
  } catch (error: any) {
    return res.status(error?.statusCode || 403).json({ error: error?.message || "Thread is outside the selected context" });
  }

  const up = await supabaseAdmin
    .from("dm_reports")
    .upsert(
      {
        estate_id: msg.estate_id,
        home_id: thread.home_id || null,
        thread_id: msg.thread_id,
        message_id: msg.id,
        reported_by: user.id,
        reason,
        details: details || null,
        status: "open",
      } as any,
      { onConflict: "message_id,reported_by" }
    )
    .select("*")
    .single();
  if (up.error) return res.status(500).json({ error: up.error.message });

  const estateId = String(msg.estate_id || "");
  if (estateId) {
    for (const role of ["manager", "estate_admin", "owner", "security"]) {
      await NotificationService.sendToRole(estateId, role, {
        title: "Chat report submitted",
        message: "A resident reported a chat message for moderation.",
        type: "system",
        payload: { reportId: up.data?.id, messageId: msg.id, threadId: msg.thread_id, kind: "chat.report" },
        entityId: String(up.data?.id || ""),
      });
    }
  }

  return res.json({ ok: true, report: up.data });
}

export async function listModerationReports(req: Request, res: Response) {
  const user = req.user as any;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });
  if (!MOD_ROLES.has(String(user.role || ""))) return res.status(403).json({ error: "Insufficient permissions" });
  if (!(await ensureMessageTables(res))) return;

  const status = clean(req.query.status || "open");
  const limit = Math.max(1, Math.min(200, Number.parseInt(clean(req.query.limit), 10) || 50));

  let q = supabaseAdmin
    .from("dm_reports")
    .select("*")
    .eq("estate_id", user.estate_id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (status && status !== "all") q = q.eq("status", status);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ reports: data || [] });
}

export async function resolveModerationReport(req: Request, res: Response) {
  const user = req.user as any;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });
  if (!MOD_ROLES.has(String(user.role || ""))) return res.status(403).json({ error: "Insufficient permissions" });
  if (!(await ensureMessageTables(res))) return;

  const reportId = clean(req.params.reportId);
  const action = clean(req.body?.action || "resolve");
  const note = clean(req.body?.note);
  const muteHours = Math.max(1, Math.min(24 * 30, Number.parseInt(clean(req.body?.mute_hours), 10) || 24));

  if (!reportId) return res.status(400).json({ error: "reportId is required" });

  const { data: report, error: rErr } = await supabaseAdmin
    .from("dm_reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();
  if (rErr) return res.status(500).json({ error: rErr.message });
  if (!report?.id) return res.status(404).json({ error: "Report not found" });
  if (String(report.estate_id) !== String(user.estate_id)) return res.status(403).json({ error: "Unauthorized" });

  const { data: msg, error: mErr } = await supabaseAdmin
    .from("dm_messages")
    .select("id,thread_id,sender_id,is_hidden")
    .eq("id", report.message_id)
    .maybeSingle();
  if (mErr) return res.status(500).json({ error: mErr.message });

  const nowIso = new Date().toISOString();
  const metadata: Record<string, any> = {};

  if (action === "hide_message" && msg?.id) {
    await supabaseAdmin
      .from("dm_messages")
      .update({ is_hidden: true, hidden_reason: note || "policy_violation", updated_at: nowIso } as any)
      .eq("id", msg.id);
    metadata.hidden = true;
  }

  if (action === "mute_sender" && msg?.sender_id && msg?.thread_id) {
    const until = new Date(Date.now() + muteHours * 60 * 60 * 1000).toISOString();
    await supabaseAdmin
      .from("dm_thread_members")
      .update({ muted_until: until } as any)
      .eq("thread_id", msg.thread_id)
      .eq("user_id", msg.sender_id);
    metadata.muted_until = until;
    metadata.mute_hours = muteHours;
  }

  const resolvedStatus = action === "dismiss" ? "dismissed" : "resolved";
  const { data: updated, error: upErr } = await supabaseAdmin
    .from("dm_reports")
    .update({
      status: resolvedStatus,
      resolution_action: action,
      resolved_by: user.id,
      resolved_note: note || null,
      resolved_at: nowIso,
      updated_at: nowIso,
    } as any)
    .eq("id", reportId)
    .select("*")
    .single();
  if (upErr) return res.status(500).json({ error: upErr.message });

  await supabaseAdmin.from("dm_moderation_logs").insert({
    estate_id: report.estate_id,
    thread_id: report.thread_id,
    message_id: report.message_id,
    actor_id: user.id,
    target_user_id: msg?.sender_id || null,
    action,
    note: note || null,
    metadata,
  } as any);

  if (msg?.sender_id) {
    await NotificationService.sendToUser(String(msg.sender_id), {
      title: "Chat moderation update",
      message:
        action === "dismiss"
          ? "A reported message was reviewed."
          : action === "hide_message"
          ? "One of your messages was hidden by moderation."
          : action === "mute_sender"
          ? "You were muted in a chat thread by moderation."
          : "A moderation action was applied.",
      type: "system",
      payload: {
        threadId: report.thread_id,
        thread_id: report.thread_id,
        messageId: report.message_id,
        message_id: report.message_id,
        reportId: report.id,
        action,
        estate_id: report.estate_id || null,
        home_id: report.home_id || null,
      },
      routing: {
        source_type: "message",
        source_id: String(report.thread_id || report.id),
        destination: "page",
        target: { target_type: "message", target_id: String(report.thread_id || ""), open_as: "page", action: "inspect" },
        actionability: "informational",
        attention_eligible: false,
        queue_eligible: false,
        acknowledgement_required: false,
      },
      entityId: String(report.id),
    });
  }

  return res.json({ ok: true, report: updated });
}
