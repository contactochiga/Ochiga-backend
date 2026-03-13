import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
  createOrGetDirectThread,
  listInbox,
  listModerationReports,
  listResidents,
  listThreadMessages,
  markThreadRead,
  reportMessage,
  resolveModerationReport,
  sendMessage,
} from "../controllers/messagesController";

const router = Router();

router.get("/residents", requireAuth, listResidents);
router.get("/inbox", requireAuth, listInbox);
router.post("/thread/direct", requireAuth, createOrGetDirectThread);
router.get("/thread/:threadId/messages", requireAuth, listThreadMessages);
router.post("/thread/:threadId/messages", requireAuth, sendMessage);
router.post("/thread/:threadId/read", requireAuth, markThreadRead);

router.post("/message/:messageId/report", requireAuth, reportMessage);

router.get("/mod/reports", requireAuth, listModerationReports);
router.post("/mod/reports/:reportId/resolve", requireAuth, resolveModerationReport);

export default router;

