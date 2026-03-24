// src/routes/community.ts
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
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
  requireRole("resident", "manager", "estate_admin", "owner", "operator", "security"),
  CommunityCtrl.createPost
);

router.post(
  "/media/upload",
  requireAuth,
  requireRole("resident", "manager", "estate_admin", "owner", "operator", "security"),
  CommunityCtrl.uploadMedia
);

router.post(
  "/live/start",
  requireAuth,
  requireRole("resident", "manager", "estate_admin", "owner", "operator", "security"),
  CommunityCtrl.startLiveSession
);

router.post(
  "/live/:postId/stop",
  requireAuth,
  requireRole("resident", "manager", "estate_admin", "owner", "operator", "security"),
  CommunityCtrl.stopLiveSession
);

router.get(
  "/live/:postId",
  requireAuth,
  CommunityCtrl.getLiveSession
);

// Get all posts for an estate
router.get(
  "/posts/estate/:estateId",
  requireAuth,
  CommunityCtrl.getPostsForEstate
);

// Get single post
router.get(
  "/post/:postId",
  requireAuth,
  CommunityCtrl.getPostById
);

router.post(
  "/post/:postId/view",
  requireAuth,
  CommunityCtrl.trackPostView
);

// Update post (author, manager, estate admin enforced in controller)
router.put(
  "/post/:postId",
  requireAuth,
  requireRole("resident", "manager", "estate_admin", "owner", "operator", "security"),
  CommunityCtrl.updatePost
);

// Delete post (manager / estate admin)
router.delete(
  "/post/:postId",
  requireAuth,
  requireRole("manager", "estate_admin", "owner", "operator"),
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
  requireRole("resident", "manager", "estate_admin", "owner", "operator", "security"),
  CommunityCtrl.createComment
);

// Get comments for post
router.get(
  "/post/:postId/comments",
  requireAuth,
  CommunityCtrl.getCommentsForPost
);

// Update comment
router.put(
  "/comment/:commentId",
  requireAuth,
  requireRole("resident", "manager", "estate_admin", "owner", "operator", "security"),
  CommunityCtrl.updateComment
);

// Delete comment (manager / estate admin)
router.delete(
  "/comment/:commentId",
  requireAuth,
  requireRole("manager", "estate_admin", "owner", "operator"),
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
  requireRole("resident", "manager", "estate_admin", "owner", "operator", "security"),
  CommunityCtrl.reactToPost
);

router.post(
  "/comment/:commentId/react",
  requireAuth,
  requireRole("resident", "manager", "estate_admin", "owner", "operator", "security"),
  CommunityCtrl.reactToComment
);

export default router;
