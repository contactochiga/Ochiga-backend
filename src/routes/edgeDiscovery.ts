import { Router } from "express";

export const edgeDiscoveryRouter = Router();

/**
 * TEMP in-memory store for speed (good for demo + recording).
 * Later we move this to DB: discovered_devices table.
 */
const store: Record<string, any[]> = {}; // site_id -> devices[]

/**
 * Edge agent pushes discovered devices
 * POST /edge/discovery/push
 * body: { site_id: string, agent_id: string, devices: any[] }
 */
edgeDiscoveryRouter.post("/edge/discovery/push", (req, res) => {
  const { site_id, agent_id, devices } = req.body || {};

  if (!site_id || !agent_id || !Array.isArray(devices)) {
    return res.status(400).json({ error: "site_id, agent_id, devices[] required" });
  }

  store[site_id] = devices.map((d) => ({
    ...d,
    agent_id,
    last_seen_at: new Date().toISOString(),
  }));

  return res.json({ ok: true, site_id, count: store[site_id].length });
});

/**
 * Facility UI fetches discovered devices
 * GET /edge/discovery/:siteId
 */
edgeDiscoveryRouter.get("/edge/discovery/:siteId", (req, res) => {
  const siteId = req.params.siteId;
  return res.json({ site_id: siteId, devices: store[siteId] || [] });
});
