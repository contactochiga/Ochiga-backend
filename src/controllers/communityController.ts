// src/controllers/communityController.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { NotificationService } from "../services/NotificationService";
import { UserRole } from "../types/user";

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

  try {
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

    await NotificationService.sendToEstate(estateId, {
      title: "New Community Post",
      message: `${user.username ?? "A resident"} posted: ${title}`,
      type: "community",
      payload: { postId: data.id },
    });

    return res.json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getPostsForEstate(req: Request, res: Response) {
  const estateId = req.params.estateId;

  const { data, error } = await supabaseAdmin
    .from("community_posts")
    .select("*")
    .eq("estate_id", estateId)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
}

export async function getPostById(req: Request, res: Response) {
  const postId = req.params.postId;

  const { data, error } = await supabaseAdmin
    .from("community_posts")
    .select("*")
    .eq("id", postId)
    .single();

  if (error) return res.status(500).json({ error: error.message });
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

  if (post.user_id !== user.id && !canModerate(user.role)) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  const { data, error } = await supabaseAdmin
    .from("community_posts")
    .update({
      title,
      content,
      media,
      poll,
      updated_at: new Date().toISOString(),
    })
    .eq("id", postId)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
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

  if (post.user_id !== user.id && !canModerate(user.role)) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  const { data, error } = await supabaseAdmin
    .from("community_posts")
    .update({ status: "deleted", updated_at: new Date().toISOString() })
    .eq("id", postId)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
}

/* =================================================
 * COMMENTS
 * ================================================= */

export async function createComment(req: Request, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const postId = req.params.postId;
  const { content, parent_comment_id } = req.body;

  if (!content) return res.status(400).json({ error: "Content required" });

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
    .select("user_id")
    .eq("id", postId)
    .single();

  if (post && post.user_id !== user.id) {
    await NotificationService.sendToUser(post.user_id, {
      title: "New Comment",
      message: `${user.username ?? "Someone"} commented on your post`,
      type: "community",
      payload: { postId, commentId: data.id },
    });
  }

  return res.json(data);
}

export async function getCommentsForPost(req: Request, res: Response) {
  const postId = req.params.postId;

  const { data, error } = await supabaseAdmin
    .from("community_comments")
    .select("*")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
}

export async function updateComment(req: Request, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const commentId = req.params.commentId;
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
    .update({ content, updated_at: new Date().toISOString() })
    .eq("id", commentId)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
}

export async function deleteComment(req: Request, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const commentId = req.params.commentId;

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
    .delete()
    .eq("id", commentId)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
}

/* =================================================
 * REACTIONS
 * ================================================= */

export async function reactToPost(req: Request, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { type } = req.body;
  const postId = req.params.postId;

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
  return res.json(data);
}

export async function reactToComment(req: Request, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { type } = req.body;
  const commentId = req.params.commentId;

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
