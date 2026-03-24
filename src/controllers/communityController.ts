// src/controllers/communityController.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { UserRole } from "../types/user";
import { uploadToS3 } from "../services/s3Service";
import { NotificationService } from "../services/NotificationService";
import { CommunityLiveService } from "../services/communityLiveService";
// import { handleSignal } from "../core/control-plane"; // enable later

/* ------------------------------------------------
 * Helpers
 * ------------------------------------------------ */
function canModerate(role?: UserRole) {
  return (
    role === "manager" ||
    role === "estate_admin" ||
    role === "admin" ||
    role === "owner" ||
    role === "operator"
  );
}

function isMissingColumn(err: any, column: string) {
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("column") && msg.includes(column.toLowerCase()) && msg.includes("does not exist");
}

function isMissingTable(err: any, table: string) {
  const msg = String(err?.message || "").toLowerCase();
  return (
    (msg.includes("could not find the table") || msg.includes("relation") || msg.includes("does not exist")) &&
    msg.includes(String(table).toLowerCase())
  );
}

function looksLikeAnnouncement(title?: string | null, role?: string | null) {
  const t = String(title || "").toLowerCase();
  const r = String(role || "").toLowerCase();
  return (
    r.includes("admin") ||
    r.includes("manager") ||
    t.includes("announcement") ||
    t.includes("notice") ||
    t.includes("maintenance") ||
    t.includes("update") ||
    t.includes("policy")
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
    "video/ogg": "ogg",
    "video/quicktime": "mov",
  };
  if (mime && map[mime]) return map[mime];
  return fallback;
}

function sanitizePart(v: string) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseStructuredBody(body?: string | null) {
  const raw = String(body || "").trim();
  if (!raw.startsWith("__OYI_POST_V1__:")) return null;
  try {
    return JSON.parse(raw.slice("__OYI_POST_V1__:".length));
  } catch {
    return null;
  }
}

function normalizeMediaItems(value: any) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item: any, idx: number) => ({
      id: String(item?.id || idx),
      type: item?.type === "video" || item?.mediaType === "video" ? "video" : "image",
      url: String(item?.url || ""),
      name: item?.name ? String(item.name) : null,
    }))
    .filter((item: any) => item.url);
}

function normalizePostOutput(row: any, extra: Record<string, any> = {}) {
  const structured = parseStructuredBody(row?.body);
  const media = normalizeMediaItems(row?.media ?? structured?.attachments ?? []);
  const content =
    row?.content != null
      ? String(row.content)
      : structured?.text != null
      ? String(structured.text)
      : String(row?.body || row?.title || "");
  const liveLink =
    row?.live_link != null
      ? String(row.live_link || "")
      : structured?.liveLink != null
      ? String(structured.liveLink || "")
      : null;

  return {
    ...row,
    content,
    media,
    live_link: liveLink || null,
    live_session:
      typeof liveLink === "string" && liveLink.startsWith("oyi-live://")
        ? CommunityLiveService.get(String(row?.id || "")) || {
            post_id: String(row?.id || ""),
            status: "ended",
            viewer_count: 0,
            is_live: false,
          }
        : null,
    ...extra,
  };
}

async function loadPostViewSummary(postIds: string[], userId?: string | null) {
  const ids = Array.from(new Set(postIds.map((id) => String(id || "")).filter(Boolean)));
  const counts: Record<string, number> = {};
  const viewedByMe = new Set<string>();

  if (!ids.length) return { counts, viewedByMe };

  const countFromRows = (rows: any[] | null | undefined, postKey = "post_id") => {
    for (const row of rows || []) {
      const pid = String((row as any)?.[postKey] || "");
      if (!pid) continue;
      counts[pid] = (counts[pid] || 0) + 1;
      if (userId && String((row as any)?.user_id || "") === String(userId)) viewedByMe.add(pid);
    }
  };

  const viewsTable = await supabaseAdmin
    .from("community_post_views")
    .select("post_id,user_id")
    .in("post_id", ids);

  if (!viewsTable.error) {
    countFromRows(viewsTable.data);
    return { counts, viewedByMe };
  }

  if (!isMissingTable(viewsTable.error, "community_post_views")) {
    throw new Error(viewsTable.error.message);
  }

  const { data: posts, error: postErr } = await supabaseAdmin
    .from("community_posts")
    .select("id,view_count,views")
    .in("id", ids);

  if (postErr) {
    if (isMissingColumn(postErr, "view_count")) {
      const { data: fallback, error: fallbackErr } = await supabaseAdmin
        .from("community_posts")
        .select("id,views")
        .in("id", ids);
      if (fallbackErr && !isMissingColumn(fallbackErr, "views")) {
        throw new Error(fallbackErr.message);
      }
      for (const row of fallback || []) {
        const pid = String((row as any)?.id || "");
        if (!pid) continue;
        counts[pid] = Number((row as any)?.views || 0);
      }
      return { counts, viewedByMe };
    }
    throw new Error(postErr.message);
  }

  for (const row of posts || []) {
    const pid = String((row as any)?.id || "");
    if (!pid) continue;
    counts[pid] = Number((row as any)?.view_count ?? (row as any)?.views ?? 0);
  }

  return { counts, viewedByMe };
}

async function incrementPostViewCounter(postId: string) {
  const { data: post, error } = await supabaseAdmin
    .from("community_posts")
    .select("id,view_count,views")
    .eq("id", postId)
    .single();

  if (error) {
    if (isMissingColumn(error, "view_count")) {
      const { data: fallback, error: fallbackErr } = await supabaseAdmin
        .from("community_posts")
        .select("id,views")
        .eq("id", postId)
        .single();
      if (fallbackErr) throw new Error(fallbackErr.message);
      const nextViews = Number((fallback as any)?.views || 0) + 1;
      const { data: updated, error: updErr } = await supabaseAdmin
        .from("community_posts")
        .update({ views: nextViews, updated_at: new Date().toISOString() } as any)
        .eq("id", postId)
        .select("id,views")
        .single();
      if (updErr) throw new Error(updErr.message);
      return Number((updated as any)?.views || nextViews);
    }
    throw new Error(error.message);
  }

  const nextCount = Number((post as any)?.view_count ?? (post as any)?.views ?? 0) + 1;
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if ((post as any)?.view_count !== undefined) patch.view_count = nextCount;
  else patch.views = nextCount;

  const { data: updated, error: updErr } = await supabaseAdmin
    .from("community_posts")
    .update(patch)
    .eq("id", postId)
    .select("id,view_count,views")
    .single();

  if (updErr) throw new Error(updErr.message);
  return Number((updated as any)?.view_count ?? (updated as any)?.views ?? nextCount);
}

async function insertCommunityPostWithFallback(payload: Record<string, any>) {
  let next = { ...payload };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data, error } = await supabaseAdmin
      .from("community_posts")
      .insert(next)
      .select("*")
      .single();
    if (!error) return data;
    if (isMissingColumn(error, "media") && Object.prototype.hasOwnProperty.call(next, "media")) {
      delete next.media;
      continue;
    }
    if (isMissingColumn(error, "live_link") && Object.prototype.hasOwnProperty.call(next, "live_link")) {
      delete next.live_link;
      continue;
    }
    throw new Error(error.message);
  }
  throw new Error("Failed to create community post");
}

async function updateCommunityPostWithFallback(postId: string, patch: Record<string, any>) {
  let next = { ...patch };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data, error } = await supabaseAdmin
      .from("community_posts")
      .update(next)
      .eq("id", postId)
      .select("*")
      .single();
    if (!error) return data;
    if (isMissingColumn(error, "media") && Object.prototype.hasOwnProperty.call(next, "media")) {
      delete next.media;
      continue;
    }
    if (isMissingColumn(error, "live_link") && Object.prototype.hasOwnProperty.call(next, "live_link")) {
      delete next.live_link;
      continue;
    }
    throw new Error(error.message);
  }
  throw new Error("Failed to update community post");
}

async function hasEstateAccess(user: any, estateId: string) {
  const userEstate = String(user?.estate_id || "");
  if (userEstate && userEstate === String(estateId)) return true;
  if (!user?.id) return false;

  const { data, error } = await supabaseAdmin
    .from("estate_memberships")
    .select("id,status")
    .eq("estate_id", estateId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (error) return false;
  return !!data?.id;
}

/* =================================================
 * POSTS
 * ================================================= */

export async function createPost(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { title, content, body, estateId, estate_id, media, liveLink, live_link } = req.body || {};

  const resolvedEstateId = estate_id || estateId || user?.estate_id;
  const resolvedBody = body ?? content ?? null;

  if (!resolvedEstateId) {
    return res.status(400).json({ error: "estateId is required" });
  }
  if (!(await hasEstateAccess(user, String(resolvedEstateId)))) {
    return res.status(403).json({ error: "Unauthorized estate access" });
  }
  const normalizedBody = resolvedBody ? String(resolvedBody).trim() : "";
  const normalizedTitle = String(title || "").trim();
  const derivedTitle =
    normalizedTitle ||
    (normalizedBody ? normalizedBody.slice(0, 80).trim() : "") ||
    (normalizeMediaItems(media).length ? "Media update" : "") ||
    (String(live_link || liveLink || "").trim() ? "Live update" : "") ||
    "Community update";

  if (!normalizedBody && !normalizeMediaItems(media).length && !String(live_link || liveLink || "").trim()) {
    return res.status(400).json({ error: "content, media, or live link is required" });
  }

  // ✅ Match your real schema exactly: author_id + body
  const payload: any = {
    estate_id: resolvedEstateId,
    author_id: user.id,
    title: derivedTitle,
    body: normalizedBody || null,
    status: "active",
  };

  const normalizedMedia = normalizeMediaItems(media);
  if (normalizedMedia.length) payload.media = normalizedMedia;
  const nextLiveLink = String(live_link || liveLink || "").trim();
  if (nextLiveLink) payload.live_link = nextLiveLink;

  let data: any;
  try {
    data = await insertCommunityPostWithFallback(payload);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Failed to create post" });
  }

  if (looksLikeAnnouncement(String(title), String(user?.role || ""))) {
    try {
      await NotificationService.sendToEstate(String(resolvedEstateId), {
        title: String(title).trim(),
        message: resolvedBody ? String(resolvedBody).trim().slice(0, 220) : "New estate announcement.",
        type: "community",
        payload: {
          estate_id: String(resolvedEstateId),
          post_id: String((data as any)?.id || ""),
          kind: "community.announcement",
        },
        entityId: String((data as any)?.id || ""),
      });
    } catch (notifyErr) {
      console.warn("community announcement notify failed:", notifyErr);
    }
  }

  return res.json(normalizePostOutput(data));
}

export async function startLiveSession(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { title, content, body, estateId, estate_id } = req.body || {};
  const resolvedEstateId = estate_id || estateId || user?.estate_id;
  if (!resolvedEstateId) return res.status(400).json({ error: "estateId is required" });
  if (!(await hasEstateAccess(user, String(resolvedEstateId)))) {
    return res.status(403).json({ error: "Unauthorized estate access" });
  }

  const normalizedBody = String(body ?? content ?? "").trim();
  const normalizedTitle = String(title || "").trim();
  const derivedTitle =
    normalizedTitle || (normalizedBody ? normalizedBody.slice(0, 80).trim() : "") || "Live now";

  const payload: any = {
    estate_id: resolvedEstateId,
    author_id: user.id,
    title: derivedTitle,
    body: normalizedBody || null,
    status: "active",
    live_link: "oyi-live://pending",
  };

  let data: any;
  try {
    data = await insertCommunityPostWithFallback(payload);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Failed to start live session" });
  }

  const postId = String((data as any)?.id || "");
  if (!postId) return res.status(500).json({ error: "Live post id missing" });

  const liveLink = `oyi-live://${postId}`;
  let updated = data;
  try {
    updated = await updateCommunityPostWithFallback(postId, {
      live_link: liveLink,
      updated_at: new Date().toISOString(),
    });
  } catch {
    updated = { ...data, live_link: liveLink };
  }

  const liveSession = await CommunityLiveService.start({
    postId,
    estateId: String(resolvedEstateId),
    hostUserId: String(user.id),
  });

  try {
    await NotificationService.sendToEstate(String(resolvedEstateId), {
      title: `${derivedTitle}`,
      message: `${String(user?.username || user?.full_name || "A resident")} just started a live session.`,
      type: "community",
      payload: {
        estate_id: String(resolvedEstateId),
        post_id: postId,
        kind: "community.live.started",
      },
      entityId: postId,
    });
  } catch {
    // fail-soft
  }

  return res.json(normalizePostOutput(updated, {
    live_session: liveSession,
    rtc_config: await CommunityLiveService.rtcConfig(),
  }));
}

export async function stopLiveSession(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { postId } = req.params;
  const { data: post, error } = await supabaseAdmin
    .from("community_posts")
    .select("*")
    .eq("id", postId)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!post?.id) return res.status(404).json({ error: "Post not found" });
  if (String(post.author_id || "") !== String(user.id || "") && !canModerate(user.role)) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  const liveSession = await CommunityLiveService.stop(String(postId));
  let updated = post;
  try {
    updated = await updateCommunityPostWithFallback(String(postId), {
      updated_at: new Date().toISOString(),
    });
  } catch {
    // fail-soft
  }

  return res.json(normalizePostOutput(updated, { live_session: liveSession }));
}

export async function getLiveSession(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { postId } = req.params;
  const { data: post, error } = await supabaseAdmin
    .from("community_posts")
    .select("id,estate_id,live_link")
    .eq("id", postId)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!post?.id) return res.status(404).json({ error: "Post not found" });
  if (!(await hasEstateAccess(user, String(post.estate_id || "")))) {
    return res.status(403).json({ error: "Unauthorized estate access" });
  }

  const liveSession = CommunityLiveService.get(String(postId));
  return res.json({
    ok: true,
    post_id: String(postId),
    live_link: String((post as any)?.live_link || ""),
    rtc_config: await CommunityLiveService.rtcConfig(),
    live_session: liveSession || {
      post_id: String(postId),
      status: "ended",
      viewer_count: 0,
      is_live: false,
    },
  });
}

export async function getLiveRtcConfig(_req: Request, res: Response) {
  return res.json({
    ok: true,
    rtc_config: await CommunityLiveService.rtcConfig(),
  });
}

export async function getPostsForEstate(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  const { estateId } = req.params;
  if (!(await hasEstateAccess(user, String(estateId)))) {
    return res.status(403).json({ error: "Unauthorized estate access" });
  }

  const { data, error } = await supabaseAdmin
    .from("community_posts")
    .select("*")
    .eq("estate_id", estateId)
    .neq("status", "deleted")
    .order("created_at", { ascending: false });

  if (error) {
    // If status column ever missing, fail soft
    if (isMissingColumn(error, "status")) {
      const { data: fallback, error: e2 } = await supabaseAdmin
        .from("community_posts")
        .select("*")
        .eq("estate_id", estateId)
        .order("created_at", { ascending: false });

      if (e2) return res.status(500).json({ error: e2.message });
      return res.json(fallback || []);
    }

    return res.status(500).json({ error: error.message });
  }

  const posts = (data || []) as any[];
  if (!posts.length) return res.json([]);

  const postIds = posts.map((p) => String(p.id)).filter(Boolean);
  const myUserId = String(user.id || "");

  const likeCounts: Record<string, number> = {};
  const commentCounts: Record<string, number> = {};
  const reactedByMe = new Set<string>();
  let viewCounts: Record<string, number> = {};
  let viewedByMe = new Set<string>();

  try {
    const { data: reactionRows, error: reactErr } = await supabaseAdmin
      .from("community_reactions")
      .select("post_id,user_id,type")
      .in("post_id", postIds);

    if (reactErr && !isMissingTable(reactErr, "community_reactions")) {
      return res.status(500).json({ error: reactErr.message });
    }

    for (const r of reactionRows || []) {
      const pid = String((r as any)?.post_id || "");
      if (!pid) continue;
      const type = String((r as any)?.type || "").toLowerCase();
      if (type === "like") {
        likeCounts[pid] = (likeCounts[pid] || 0) + 1;
        if (String((r as any)?.user_id || "") === myUserId) reactedByMe.add(pid);
      }
    }
  } catch {
    // fail-soft
  }

  try {
    const { data: commentRows, error: commentErr } = await supabaseAdmin
      .from("community_comments")
      .select("post_id")
      .in("post_id", postIds);

    if (commentErr && !isMissingTable(commentErr, "community_comments")) {
      return res.status(500).json({ error: commentErr.message });
    }

    for (const c of commentRows || []) {
      const pid = String((c as any)?.post_id || "");
      if (!pid) continue;
      commentCounts[pid] = (commentCounts[pid] || 0) + 1;
    }
  } catch {
    // fail-soft
  }

  try {
    const viewSummary = await loadPostViewSummary(postIds, myUserId);
    viewCounts = viewSummary.counts;
    viewedByMe = viewSummary.viewedByMe;
  } catch {
    // fail-soft
  }

  const authorIds = Array.from(new Set(posts.map((p) => String(p.author_id || "")).filter(Boolean)));
  const authorMap = new Map<string, string>();
  if (authorIds.length) {
    const { data: users } = await supabaseAdmin
      .from("users")
      .select("id,username,full_name")
      .in("id", authorIds);
    for (const u of users || []) {
      const id = String((u as any).id || "");
      const name = String((u as any).username || (u as any).full_name || "").trim();
      if (id && name) authorMap.set(id, name);
    }
  }

  const enriched = posts.map((p) => {
    const pid = String(p.id || "");
    const likeCount = Number(likeCounts[pid] || 0);
    const commentCount = Number(commentCounts[pid] || 0);
    return normalizePostOutput(p, {
      author_name: authorMap.get(String(p.author_id || "")) || null,
      like_count: likeCount,
      likes: likeCount,
      reactions_count: likeCount,
      comment_count: commentCount,
      comments: commentCount,
      reply_count: commentCount,
      replies_count: commentCount,
      view_count: Number(viewCounts[pid] || 0),
      views: Number(viewCounts[pid] || 0),
      viewed_by_me: viewedByMe.has(pid),
      reacted_by_me: reactedByMe.has(pid),
      liked_by_me: reactedByMe.has(pid),
    });
  });

  return res.json(enriched);
}

export async function getPostById(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  const { postId } = req.params;

  const { data, error } = await supabaseAdmin
    .from("community_posts")
    .select("*")
    .eq("id", postId)
    .single();

  if (error || !data) return res.status(404).json({ error: "Post not found" });
  if (!(await hasEstateAccess(user, String((data as any).estate_id || "")))) {
    return res.status(403).json({ error: "Unauthorized estate access" });
  }

  let viewCount = Number((data as any)?.view_count ?? (data as any)?.views ?? 0);
  let viewedByMe = false;
  try {
    const summary = await loadPostViewSummary([String(postId)], String(user.id || ""));
    viewCount = Number(summary.counts[String(postId)] || viewCount);
    viewedByMe = summary.viewedByMe.has(String(postId));
  } catch {
    // fail-soft
  }

  return res.json(
    normalizePostOutput(data, {
      view_count: viewCount,
      views: viewCount,
      viewed_by_me: viewedByMe,
    })
  );
}

export async function trackPostView(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { postId } = req.params;
  const { data: post, error: postErr } = await supabaseAdmin
    .from("community_posts")
    .select("id,estate_id")
    .eq("id", postId)
    .maybeSingle();
  if (postErr) return res.status(500).json({ error: postErr.message });
  if (!post?.id) return res.status(404).json({ error: "Post not found" });
  if (!(await hasEstateAccess(user, String(post.estate_id || "")))) {
    return res.status(403).json({ error: "Unauthorized estate access" });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("community_post_views")
      .upsert(
        {
          post_id: postId,
          user_id: String(user.id),
          estate_id: String(post.estate_id || user.estate_id || ""),
          viewed_at: new Date().toISOString(),
        } as any,
        { onConflict: "post_id,user_id" }
      )
      .select("post_id,user_id");

    if (!error) {
      const count = (data || []).length
        ? await loadPostViewSummary([String(postId)], String(user.id || "")).then((x) => Number(x.counts[String(postId)] || 0))
        : await loadPostViewSummary([String(postId)], String(user.id || "")).then((x) => Number(x.counts[String(postId)] || 0));
      return res.json({
        ok: true,
        post_id: postId,
        view_count: count,
        views: count,
        viewed_by_me: true,
      });
    }

    if (!isMissingTable(error, "community_post_views")) {
      return res.status(500).json({ error: error.message });
    }

    const nextCount = await incrementPostViewCounter(String(postId));
    return res.json({
      ok: true,
      post_id: postId,
      view_count: nextCount,
      views: nextCount,
      viewed_by_me: true,
      fallback: true,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to track post view" });
  }
}

export async function updatePost(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { postId } = req.params;
  const { title, content, body, status, media, liveLink, live_link } = req.body || {};

  const { data: post, error: pErr } = await supabaseAdmin
    .from("community_posts")
    .select("*")
    .eq("id", postId)
    .single();

  if (pErr || !post) return res.status(404).json({ error: "Post not found" });

  // ✅ Your schema uses author_id
  if (post.author_id !== user.id && !canModerate(user.role)) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  const patch: any = {
    updated_at: new Date().toISOString(),
  };

  if (title !== undefined) patch.title = title ? String(title).trim() : null;
  const resolvedBody = body ?? content;
  if (resolvedBody !== undefined) patch.body = resolvedBody ? String(resolvedBody).trim() : null;
  if (status !== undefined && canModerate(user.role)) patch.status = String(status);
  if (media !== undefined) patch.media = normalizeMediaItems(media);
  if (live_link !== undefined || liveLink !== undefined) {
    const nextLiveLink = String(live_link ?? liveLink ?? "").trim();
    patch.live_link = nextLiveLink || null;
  }

  try {
    const data = await updateCommunityPostWithFallback(postId, patch);
    return res.json(normalizePostOutput(data));
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Failed to update post" });
  }
}

export async function deletePost(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { postId } = req.params;

  const { data: post } = await supabaseAdmin
    .from("community_posts")
    .select("*")
    .eq("id", postId)
    .single();

  if (!post) return res.status(404).json({ error: "Post not found" });

  if (!canModerate(user.role)) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  // ✅ soft delete using status column (exists)
  const { data, error } = await supabaseAdmin
    .from("community_posts")
    .update({
      status: "deleted",
      updated_at: new Date().toISOString(),
    })
    .eq("id", postId)
    .select("*")
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
}

/* =================================================
 * COMMENTS / REACTIONS
 * =================================================
 * NOTE: These assume your tables exist as named.
 * If your schema differs, we’ll align the columns same way.
 */

export async function createComment(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { postId } = req.params;
  const { content, parent_comment_id } = req.body;

  if (!content) return res.status(400).json({ error: "Content required" });

  const { data: post, error: postErr } = await supabaseAdmin
    .from("community_posts")
    .select("id,estate_id")
    .eq("id", postId)
    .maybeSingle();
  if (postErr) return res.status(500).json({ error: postErr.message });
  if (!post?.id) return res.status(404).json({ error: "Post not found" });
  if (!(await hasEstateAccess(user, String(post.estate_id || "")))) {
    return res.status(403).json({ error: "Unauthorized estate access" });
  }

  const { data, error } = await supabaseAdmin
    .from("community_comments")
    .insert({
      post_id: postId,
      content,
      parent_comment_id: parent_comment_id ?? null,
      user_id: user.id,
    })
    .select()
    .single();

  if (error) {
    if (isMissingTable(error, "community_comments")) {
      return res.status(503).json({
        error: "Comments are not configured yet (community_comments table missing).",
        code: "COMMUNITY_COMMENTS_TABLE_MISSING",
      });
    }
    return res.status(500).json({ error: error.message });
  }

  try {
    const { data: post } = await supabaseAdmin
      .from("community_posts")
      .select("id,author_id,title")
      .eq("id", postId)
      .maybeSingle();

    const ownerId = String(post?.author_id || "");
    if (ownerId && ownerId !== user.id) {
      await NotificationService.sendToUser(ownerId, {
        title: "New Comment",
        message: "Someone commented on your post",
        type: "community",
        payload: {
          postId,
          commentId: data?.id,
          authorId: user.id,
        },
        entityId: postId,
      });
    }
  } catch {
    // fail-soft: comment still succeeds
  }

  let commentCount = 0;
  try {
    const { data: countRows } = await supabaseAdmin
      .from("community_comments")
      .select("id", { count: "exact" })
      .eq("post_id", postId);
    commentCount = Number(countRows?.length || 0);
  } catch {
    // fail-soft
  }

  return res.json({
    ...data,
    author_name: String(user?.username || user?.full_name || user?.email || "Resident"),
    comment_count: commentCount,
    replies_count: commentCount,
    reply_count: commentCount,
  });
}

export async function getCommentsForPost(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  const { postId } = req.params;

  const { data: post, error: postErr } = await supabaseAdmin
    .from("community_posts")
    .select("id,estate_id")
    .eq("id", postId)
    .maybeSingle();
  if (postErr) return res.status(500).json({ error: postErr.message });
  if (!post?.id) return res.status(404).json({ error: "Post not found" });
  if (!(await hasEstateAccess(user, String(post.estate_id || "")))) {
    return res.status(403).json({ error: "Unauthorized estate access" });
  }

  const { data, error } = await supabaseAdmin
    .from("community_comments")
    .select("*")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  const authorIds = Array.from(
    new Set((data || []).map((row: any) => String(row?.user_id || "")).filter(Boolean))
  );
  let authorMap = new Map<string, string>();
  if (authorIds.length) {
    const { data: users } = await supabaseAdmin
      .from("users")
      .select("id,username,full_name,email")
      .in("id", authorIds);
    authorMap = new Map(
      (users || []).map((u: any) => [
        String(u?.id || ""),
        String(u?.username || u?.full_name || u?.email || "Resident"),
      ])
    );
  }
  return res.json(
    (data || []).map((row: any) => ({
      ...row,
      author_name: authorMap.get(String(row?.user_id || "")) || "Resident",
    }))
  );
}

export async function updateComment(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { commentId } = req.params;
  const { content } = req.body;

  const { data: comment } = await supabaseAdmin
    .from("community_comments")
    .select("*")
    .eq("id", commentId)
    .single();

  if (!comment) return res.status(404).json({ error: "Comment not found" });

  if (comment.user_id !== user.id && !canModerate(user.role)) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  const { data, error } = await supabaseAdmin
    .from("community_comments")
    .update({
      content,
      updated_at: new Date().toISOString(),
    })
    .eq("id", commentId)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
}

export async function deleteComment(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { commentId } = req.params;

  const { data: comment } = await supabaseAdmin
    .from("community_comments")
    .select("*")
    .eq("id", commentId)
    .single();

  if (!comment) return res.status(404).json({ error: "Comment not found" });

  if (!canModerate(user.role)) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  const { error } = await supabaseAdmin
    .from("community_comments")
    .delete()
    .eq("id", commentId);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
}

export async function reactToPost(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { postId } = req.params;
  const { type } = req.body;

  if (!type) return res.status(400).json({ error: "Reaction type required" });

  const { data: post, error: postErr } = await supabaseAdmin
    .from("community_posts")
    .select("id,estate_id,author_id,title")
    .eq("id", postId)
    .maybeSingle();
  if (postErr) return res.status(500).json({ error: postErr.message });
  if (!post?.id) return res.status(404).json({ error: "Post not found" });
  if (!(await hasEstateAccess(user, String(post.estate_id || "")))) {
    return res.status(403).json({ error: "Unauthorized estate access" });
  }

  const { data, error } = await supabaseAdmin
    .from("community_reactions")
    .upsert(
      {
        post_id: postId,
        user_id: user.id,
        type,
      },
      { onConflict: "post_id,user_id" }
    )
    .select()
    .single();

  if (error) {
    if (isMissingTable(error, "community_reactions")) {
      // fail-soft so UI can keep working until migration is applied
      return res.json({
        ok: true,
        fallback: true,
        post_id: postId,
        user_id: user.id,
        type,
      });
    }
    return res.status(500).json({ error: error.message });
  }

  try {
    if (String(type).toLowerCase() === "like") {
      const ownerId = String(post?.author_id || "");
      if (ownerId && ownerId !== user.id) {
        await NotificationService.sendToUser(ownerId, {
          title: "New Like",
          message: "Someone liked your post",
          type: "community",
          payload: {
            postId,
            authorId: user.id,
          },
          entityId: postId,
        });
      }
    }
  } catch {
    // fail-soft
  }

  let likeCount = 0;
  try {
    const { data: rows } = await supabaseAdmin
      .from("community_reactions")
      .select("id,type")
      .eq("post_id", postId);
    likeCount = (rows || []).filter((x: any) => String(x?.type || "").toLowerCase() === "like").length;
  } catch {
    // fail-soft
  }

  return res.json({
    ...data,
    like_count: likeCount,
    likes: likeCount,
    reactions_count: likeCount,
    reacted_by_me: true,
    liked_by_me: true,
  });
}

export async function reactToComment(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { commentId } = req.params;
  const { type } = req.body;

  if (!type) return res.status(400).json({ error: "Reaction type required" });

  const { data: comment, error: commentErr } = await supabaseAdmin
    .from("community_comments")
    .select("id,post_id")
    .eq("id", commentId)
    .maybeSingle();
  if (commentErr) return res.status(500).json({ error: commentErr.message });
  if (!comment?.id) return res.status(404).json({ error: "Comment not found" });

  const { data: post, error: postErr } = await supabaseAdmin
    .from("community_posts")
    .select("id,estate_id")
    .eq("id", String(comment.post_id))
    .maybeSingle();
  if (postErr) return res.status(500).json({ error: postErr.message });
  if (!post?.id) return res.status(404).json({ error: "Post not found" });
  if (!(await hasEstateAccess(user, String(post.estate_id || "")))) {
    return res.status(403).json({ error: "Unauthorized estate access" });
  }

  const { data, error } = await supabaseAdmin
    .from("community_reactions")
    .upsert(
      {
        comment_id: commentId,
        user_id: user.id,
        type,
      },
      { onConflict: "comment_id,user_id" }
    )
    .select()
    .single();

  if (error) {
    if (isMissingTable(error, "community_reactions")) {
      return res.json({
        ok: true,
        fallback: true,
        comment_id: commentId,
        user_id: user.id,
        type,
      });
    }
    return res.status(500).json({ error: error.message });
  }
  return res.json(data);
}

export async function uploadMedia(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { base64, mime, filename, mediaType } = req.body || {};
  if (!base64 || !mime) {
    return res.status(400).json({ error: "base64 and mime are required" });
  }

  const allowedImage = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
  const allowedVideo = ["video/mp4", "video/webm", "video/ogg", "video/quicktime"];
  const isImage = allowedImage.includes(String(mime));
  const isVideo = allowedVideo.includes(String(mime));
  if (!isImage && !isVideo) {
    return res.status(400).json({ error: "Unsupported media type" });
  }

  const raw = String(base64);
  const cleaned = raw.includes(",") ? raw.split(",")[1] : raw;
  let buffer: Buffer;
  try {
    buffer = Buffer.from(cleaned, "base64");
  } catch {
    return res.status(400).json({ error: "Invalid base64 payload" });
  }

  if (!buffer || !buffer.length) {
    return res.status(400).json({ error: "Empty media payload" });
  }

  // hard caps at API layer
  if (isImage && buffer.length > 6 * 1024 * 1024) {
    return res.status(400).json({ error: "Image too large (max 6MB)" });
  }
  if (isVideo && buffer.length > 15 * 1024 * 1024) {
    return res.status(400).json({ error: "Video too large (max 15MB)" });
  }

  const estate = sanitizePart(String(user?.estate_id || "global"));
  const uid = sanitizePart(String(user?.id || "anon"));
  const kind = mediaType === "video" || isVideo ? "videos" : "images";
  const ext = extFromMime(String(mime), String(filename || "").split(".").pop() || "bin");
  const key = `community/${estate}/${uid}/${kind}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.${ext}`;

  try {
    const url = await uploadToS3(key, buffer, String(mime));
    return res.json({
      ok: true,
      url,
      mime,
      mediaType: kind === "videos" ? "video" : "image",
      key,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Upload failed" });
  }
}
