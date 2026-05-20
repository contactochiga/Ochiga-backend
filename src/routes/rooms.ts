import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { auditOnSuccess } from "../middleware/audit";
import * as RoomsCtrl from "../controllers/roomsController";

const router = Router();

// GET ROOMS FOR A HOME
router.get("/", requireAuth, requirePermission("homes.read"), RoomsCtrl.getRooms);

// CREATE ROOM
router.post("/", requireAuth, requirePermission("homes.write"), auditOnSuccess("room.created", "room", "roomId"), RoomsCtrl.createRoom);

// UPDATE ROOM AI PROFILE
router.put("/ai/:roomId", requireAuth, requirePermission("homes.write"), auditOnSuccess("room.updated", "room", "roomId"), RoomsCtrl.updateAiProfile);

// ASSIGN USER TO ROOM
router.post("/assign", requireAuth, requirePermission("homes.write"), auditOnSuccess("room.updated", "room", "room_id"), RoomsCtrl.assignUserToRoom);

export default router;
