import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { auditOnSuccess } from "../middleware/audit";
import { resolveRequestContext } from "../middleware/contextResolver";
import {
  createOrGetDirectThread,
  listInbox,
  listModerationReports,
  listResidents,
  listThreadMessages,
  markThreadRead,
  pingPresence,
  reportMessage,
  resolveModerationReport,
  sendMessage,
  uploadMessageMedia,
} from "../controllers/messagesController";

const router = Router();

router.get("/residents", requireAuth, resolveRequestContext, requirePermission("community.read"), listResidents);
router.post("/presence/ping", requireAuth, resolveRequestContext, requirePermission("community.read"), pingPresence);
router.get("/inbox", requireAuth, resolveRequestContext, requirePermission("community.read"), listInbox);
router.post("/thread/direct", requireAuth, resolveRequestContext, requirePermission("community.write"), createOrGetDirectThread);
router.post("/media/upload", requireAuth, resolveRequestContext, requirePermission("community.write"), auditOnSuccess("document.generated", "message_media", "mediaId"), uploadMessageMedia);
router.get("/thread/:threadId/messages", requireAuth, resolveRequestContext, requirePermission("community.read"), listThreadMessages);
router.post("/thread/:threadId/messages", requireAuth, resolveRequestContext, requirePermission("community.write"), auditOnSuccess("message.sent", "thread", "threadId"), sendMessage);
router.post("/thread/:threadId/read", requireAuth, resolveRequestContext, requirePermission("community.read"), markThreadRead);

router.post("/message/:messageId/report", requireAuth, resolveRequestContext, requirePermission("community.write"), auditOnSuccess("message.moderated", "message", "messageId"), reportMessage);

router.get("/mod/reports", requireAuth, requirePermission("support.assign"), listModerationReports);
router.post("/mod/reports/:reportId/resolve", requireAuth, requirePermission("support.assign"), auditOnSuccess("message.moderated", "moderation_report", "reportId"), resolveModerationReport);

export default router;
