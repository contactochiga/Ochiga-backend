// src/routes/community.ts
import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { auditOnSuccess } from "../middleware/audit";
import * as CommunityCtrl from "../controllers/communityController";

const router = Router();

/**
 * ============================
 * POSTS
 * ============================
 */

// Create post (residents, managers, estate admins)
router.post(
  "/post",
  requireAuth,
  requirePermission("community.write"),
  auditOnSuccess("community.post.created", "community_post", "postId"),
  CommunityCtrl.createPost
);

router.post(
  "/media/upload",
  requireAuth,
  requirePermission("community.write"),
  auditOnSuccess("document.generated", "community_media", "mediaId"),
  CommunityCtrl.uploadMedia
);

router.post(
  "/live/start",
  requireAuth,
  requirePermission("community.write"),
  auditOnSuccess("community.post.updated", "community_live", "postId"),
  CommunityCtrl.startLiveSession
);

router.get(
  "/live/config",
  requireAuth,
  requirePermission("community.read"),
  CommunityCtrl.getLiveRtcConfig
);

router.post(
  "/live/:postId/stop",
  requireAuth,
  requirePermission("community.write"),
  CommunityCtrl.stopLiveSession
);

router.get(
  "/live/:postId",
  requireAuth,
  requirePermission("community.read"),
  CommunityCtrl.getLiveSession
);

router.get(
  "/live/:postId/requests",
  requireAuth,
  requirePermission("community.read"),
  CommunityCtrl.getLiveRequests
);

router.get(
  "/live/:postId/chat",
  requireAuth,
  requirePermission("community.read"),
  CommunityCtrl.getLiveChat
);

// Get all posts for an estate
router.get(
  "/posts/estate/:estateId",
  requireAuth,
  requirePermission("community.read"),
  CommunityCtrl.getPostsForEstate
);

// Get single post
router.get(
  "/post/:postId",
  requireAuth,
  requirePermission("community.read"),
  CommunityCtrl.getPostById
);

router.post(
  "/post/:postId/view",
  requireAuth,
  requirePermission("community.read"),
  CommunityCtrl.trackPostView
);

// Update post (author, manager, estate admin enforced in controller)
router.put(
  "/post/:postId",
  requireAuth,
  requirePermission("community.write"),
  auditOnSuccess("community.post.updated", "community_post", "postId"),
  CommunityCtrl.updatePost
);

// Delete post (manager / estate admin)
router.delete(
  "/post/:postId",
  requireAuth,
  requirePermission("community.write"),
  auditOnSuccess("community.post.deleted", "community_post", "postId"),
  CommunityCtrl.deletePost
);

/**
 * ============================
 * COMMENTS
 * ============================
 */

// Create comment
router.post(
  "/post/:postId/comment",
  requireAuth,
  requirePermission("community.write"),
  auditOnSuccess("community.post.updated", "community_post", "postId"),
  CommunityCtrl.createComment
);

// Get comments for post
router.get(
  "/post/:postId/comments",
  requireAuth,
  requirePermission("community.read"),
  CommunityCtrl.getCommentsForPost
);

// Update comment
router.put(
  "/comment/:commentId",
  requireAuth,
  requirePermission("community.write"),
  auditOnSuccess("community.post.updated", "community_comment", "commentId"),
  CommunityCtrl.updateComment
);

// Delete comment (manager / estate admin)
router.delete(
  "/comment/:commentId",
  requireAuth,
  requirePermission("community.write"),
  auditOnSuccess("community.post.deleted", "community_comment", "commentId"),
  CommunityCtrl.deleteComment
);

/**
 * ============================
 * REACTIONS
 * ============================
 */

router.post(
  "/post/:postId/react",
  requireAuth,
  requirePermission("community.write"),
  auditOnSuccess("community.post.updated", "community_post", "postId"),
  CommunityCtrl.reactToPost
);

router.post(
  "/comment/:commentId/react",
  requireAuth,
  requirePermission("community.write"),
  auditOnSuccess("community.post.updated", "community_comment", "commentId"),
  CommunityCtrl.reactToComment
);

export default router;
