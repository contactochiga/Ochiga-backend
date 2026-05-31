import { Router } from "express";
import { auditOnSuccess } from "../middleware/audit";
import { requireAuth } from "../middleware/auth";
import {
  inviteHomeUser,
  listHomeUsers,
  removeHomeUser,
  updateHomeUser,
} from "../controllers/homeUsers.controller";

const router = Router();
router.use(requireAuth);

function requireActiveHome(req: any, res: any, next: any) {
  if (!req.user?.home_id) return res.status(403).json({ error: "Active home context required" });
  req.params.homeId = req.user.home_id;
  next();
}

router.get("/", requireActiveHome, listHomeUsers);
router.post("/invite", requireActiveHome, auditOnSuccess("home.member.invited", "home", "homeId"), inviteHomeUser);
router.patch("/:id", auditOnSuccess("home.member.updated", "home_membership", "id"), (req, res) => {
  req.params.membershipId = req.params.id;
  return updateHomeUser(req, res);
});
router.delete("/:id", auditOnSuccess("home.member.removed", "home_membership", "id"), (req, res) => {
  req.params.membershipId = req.params.id;
  return removeHomeUser(req, res);
});

export default router;
