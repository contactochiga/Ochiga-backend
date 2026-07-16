import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import * as controller from "../controllers/infrastructureOnboardingController";

const router = Router();

router.use(requireAuth);

router.get("/providers", requirePermission("devices.read"), controller.providerCatalog);
router.get("/history", requirePermission("devices.read"), controller.overview);
router.get("/partners", requirePermission("devices.read"), controller.partners);
router.post("/partners", requirePermission("staff.manage"), controller.createPartner);

router.post("/sessions", requirePermission("devices.control"), controller.createSession);
router.get("/sessions/:sessionId", requirePermission("devices.read"), controller.sessionDetail);
router.post("/sessions/:sessionId/providers/:providerKey/authenticate", requirePermission("devices.control"), controller.authenticateProvider);
router.post("/sessions/:sessionId/discover", requirePermission("devices.control"), controller.discover);
router.post("/sessions/:sessionId/import", requirePermission("devices.control"), controller.importCandidates);
router.post("/sessions/:sessionId/verify", requirePermission("devices.control"), controller.verifyCandidates);
router.post("/sessions/:sessionId/candidates/:candidateId/verify", requirePermission("devices.control"), controller.verifyCandidate);
router.post("/sessions/:sessionId/promote", requirePermission("devices.control"), controller.promoteCandidates);
router.post("/sessions/:sessionId/candidates/:candidateId/promote", requirePermission("devices.control"), controller.promoteCandidate);

export default router;
