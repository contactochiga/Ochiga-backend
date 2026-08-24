import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { platformGapService } from "../services/platformGapService";

const router = Router();
router.use(requireAuth);

function wrap(fn: (req: any) => Promise<any>) {
  return async (req: any, res: any) => {
    try {
      const data = await fn(req);
      res.json(data);
    } catch (error: any) {
      const message = error?.message || "Request failed";
      const status = /permission/i.test(message) ? 403 : /required|context/i.test(message) ? 400 : 500;
      res.status(status).json({ error: message });
    }
  };
}

router.get("/twin", requirePermission("twin.view"), wrap((req) => platformGapService.twin(req)));
router.post("/twin/models", requirePermission("twin.control"), wrap((req) => platformGapService.registerModel(req)));
router.patch("/twin/models/:modelId", requirePermission("twin.control"), wrap((req) => platformGapService.updateModel(req)));
router.put("/twin/placements", requirePermission("twin.control"), wrap((req) => platformGapService.upsertPlacement(req)));

router.get("/utility-telemetry", requirePermission("devices.read"), wrap((req) => platformGapService.utilityTelemetry(req)));
router.post("/utility-telemetry", requirePermission("devices.control"), wrap((req) => platformGapService.recordUtilityTelemetry(req)));

router.get("/edge/history", requirePermission("devices.read"), wrap((req) => platformGapService.edgeHistory(req)));
router.post("/edge/history", requirePermission("devices.control"), wrap((req) => platformGapService.recordEdgeHistory(req)));

router.get("/incidents", requirePermission("support.read"), wrap((req) => platformGapService.incidents(req)));
router.post("/incidents", requirePermission("support.assign"), wrap((req) => platformGapService.createIncident(req)));
router.patch("/incidents/:incidentId", requirePermission("support.assign"), wrap((req) => platformGapService.updateIncident(req)));
router.get("/incidents/:incidentId/timeline", requirePermission("support.read"), wrap((req) => platformGapService.incidentTimeline(req)));
router.get("/handover", requirePermission("support.read"), wrap((req) => platformGapService.handover(req)));
router.get("/handovers", requirePermission("support.read"), wrap((req) => platformGapService.handovers(req)));
router.post("/handovers", requirePermission("support.assign"), wrap((req) => platformGapService.createHandover(req)));

router.get("/camera-infrastructure", requirePermission("cameras.view"), wrap((req) => platformGapService.cameraInfrastructure(req)));
router.put("/camera-infrastructure", requirePermission("cameras.manage"), wrap((req) => platformGapService.upsertCameraInfrastructure(req)));

router.get("/realtime-audit", requirePermission("audit.read"), wrap(() => platformGapService.realtimeAudit()));
router.get("/deployment-readiness", requirePermission("settings.manage"), wrap(() => platformGapService.deploymentReadiness()));

export default router;
