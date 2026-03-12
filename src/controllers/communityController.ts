// src/controllers/communityController.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { UserRole } from "../types/user";
import { uploadToS3 } from "../services/s3Service";
import { NotificationService } from "../services/NotificationService";
// import { handleSignal } from "../core/control-plane"; // enable later

/* ------------------------------------------------
 * Helpers
 * ------------------------------------------------ */
function canModerate(role?: UserRole) {
  return role === "manager" || role === "estate_admin" || role === "admin";
}

function isMissingColumn(err: any, column: string) {
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("column") && msg.includes(column.toLowerCase()) && msg.includes("does not exist");
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

/* =================================================
 * POSTS
 * ================================================= */

export async function createPost(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { title, content, body, estateId, estate_id } = req.body || {};

  const resolvedEstateId = estate_id || estateId || user?.estate_id;
  const resolvedBody = body ?? content ?? null;

  if (!resolvedEstateId) {
    return res.status(400).json({ error: "estateId is required" });
  }
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: "title is required" });
  }

  // ✅ Match your real schema exactly: author_id + body
  const payload: any = {
    estate_id: resolvedEstateId,
    author_id: user.id,
    title: String(title).trim(),
    body: resolvedBody ? String(resolvedBody).trim() : null,
    status: "active",
  };

  const { data, error } = await supabaseAdmin
    .from("community_posts")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Optional later: push signals/notifications to estate users here

  return res.json(data);
}

export async function getPostsForEstate(req: Request, res: Response) {
  const { estateId } = req.params;

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

  return res.json(data || []);
}

export async function getPostById(req: Request, res: Response) {
  const { postId } = req.params;

  const { data, error } = await supabaseAdmin
    .from("community_posts")
    .select("*")
    .eq("id", postId)
    .single();

  if (error || !data) return res.status(404).json({ error: "Post not found" });

  return res.json(data);
}

export async function updatePost(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { postId } = req.params;
  const { title, content, body, status } = req.body || {};

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

  const { data, error } = await supabaseAdmin
    .from("community_posts")
    .update(patch)
    .eq("id", postId)
    .select("*")
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
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

  if (error) return res.status(500).json({ error: error.message });

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

  return res.json(data);
}

export async function getCommentsForPost(req: Request, res: Response) {
  const { postId } = req.params;

  const { data, error } = await supabaseAdmin
    .from("community_comments")
    .select("*")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
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

  if (error) return res.status(500).json({ error: error.message });

  try {
    if (String(type).toLowerCase() === "like") {
      const { data: post } = await supabaseAdmin
        .from("community_posts")
        .select("id,author_id,title")
        .eq("id", postId)
        .maybeSingle();
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

  return res.json(data);
}

export async function reactToComment(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { commentId } = req.params;
  const { type } = req.body;

  if (!type) return res.status(400).json({ error: "Reaction type required" });

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

  if (error) return res.status(500).json({ error: error.message });
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
