import type { Request, Response } from "express";
import { logger } from "../observability/logger";
import { sendPublicApiError } from "../services/publicApi";
import { buildTuyaAuthorizationDiagnostics } from "../services/tuyaAuthorizationDiagnosticsService";
import { canonicalRole } from "../core/foundation/permissions";

const DIAGNOSTIC_ROLES = new Set(["super_admin", "ochiga_admin", "ochiga_staff", "estate_admin", "facility_manager", "security_operator", "maintenance_operator"]);

export async function getTuyaAuthorizationDiagnostics(req: Request, res: Response) {
  const user: any = req.user;
  const context: any = (req as any).oisContext || null;
  const estateId = String(context?.estate_id || user?.estate_id || "").trim();
  try {
    if (!user?.id) return res.status(401).json({ error: "Not authenticated" });
    if (!DIAGNOSTIC_ROLES.has(canonicalRole(user.role))) {
      return res.status(403).json({ error: "Device provider diagnostics require facility access." });
    }
    if (!estateId) return res.status(400).json({ error: "Active estate context is required" });
    const verifyProvider = ["1", "true", "yes"].includes(String(req.query.verify_provider || "").toLowerCase());
    return res.json(await buildTuyaAuthorizationDiagnostics({ estateId, verifyProvider }));
  } catch (error) {
    logger.error("tuya_authorization_diagnostics_failed", { error, estate_id: estateId || null, actor_id: user?.id || null });
    return sendPublicApiError(
      res,
      error,
      { statusCode: 503, code: "tuya_diagnostics_unavailable", message: "Tuya diagnostics are temporarily unavailable." },
      { operation: "devices.runtime.diagnostics.tuya", estate_id: estateId },
    );
  }
}
