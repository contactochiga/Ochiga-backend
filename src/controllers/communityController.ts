// src/controllers/communityController.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { UserRole } from "../types/user";
import { handleSignal } from "../core/control-plane";

/* ------------------------------------------------
 * Helpers
 * ------------------------------------------------ */
function canModerate(role?: UserRole) {
  return role === "manager" || role === "estate_admin" || role === "admin";
}

/* =================================================
 * POSTS
 * ================================================= */

export async function createPost(req: Request, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { title, content, media, poll, estateId } = req.body;

  const { data, error } = await supabaseAdmin
    .from("community_posts")
    .insert([
      {
        title,
        content,
        media,
        poll,
        estate_id: estateId,
        user_id: user.id,
      },
    ])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // 🔔 EMIT SIGNAL
  await handleSignal({
    type: "community.post.created",
    schemaVersion: 1,
    source: "community",
    estateId,
    postId: data.id,
    authorId: user.id,
    title,
    timestamp: new Date().toISOString(),
  });

  return res.json(data);
}

export async function updatePost(req: Request, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const postId = req.params.postId;
  const { title, content, media, poll } = req.body;

  const { data: post } = await supabaseAdmin
    .from("community_posts")
    .select("*")
    .eq("id", postId)
    .single();

  if (!post) return res.status(404).json({ error: "Post not found" });
  if (post.user_id !== user.id && !canModerate(user.role))
    return res.status(403).json({ error: "Unauthorized" });

  const { data, error } = await supabaseAdmin
    .from("community_posts")
    .update({ title, content, media, poll })
    .eq("id", postId)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await handleSignal({
    type: "community.post.updated",
    schemaVersion: 1,
    source: "community",
    estateId: post.estate_id,
    postId,
    updatedBy: user.id,
    timestamp: new Date().toISOString(),
  });

  return res.json(data);
}

export async function deletePost(req: Request, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const postId = req.params.postId;

  const { data: post } = await supabaseAdmin
    .from("community_posts")
    .select("*")
    .eq("id", postId)
    .single();

  if (!post) return res.status(404).json({ error: "Post not found" });
  if (post.user_id !== user.id && !canModerate(user.role))
    return res.status(403).json({ error: "Unauthorized" });

  await supabaseAdmin
    .from("community_posts")
    .update({ status: "deleted" })
    .eq("id", postId);

  await handleSignal({
    type: "community.post.deleted",
    schemaVersion: 1,
    source: "community",
    estateId: post.estate_id,
    postId,
    deletedBy: user.id,
    timestamp: new Date().toISOString(),
  });

  return res.json({ success: true });
}

/* =================================================
 * COMMENTS
 * ================================================= */

export async function createComment(req: Request, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const postId = req.params.postId;
  const { content, parent_comment_id } = req.body;

  const { data, error } = await supabaseAdmin
    .from("community_comments")
    .insert([
      {
        post_id: postId,
        content,
        parent_comment_id: parent_comment_id ?? null,
        user_id: user.id,
      },
    ])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  const { data: post } = await supabaseAdmin
    .from("community_posts")
    .select("estate_id,user_id")
    .eq("id", postId)
    .single();

  await handleSignal({
    type: "community.comment.created",
    schemaVersion: 1,
    source: "community",
    estateId: post.estate_id,
    postId,
    commentId: data.id,
    authorId: user.id,
    postOwnerId: post.user_id,
    timestamp: new Date().toISOString(),
  });

  return res.json(data);
}
