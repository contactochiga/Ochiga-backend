import { Router } from "express";

export const edgeDiscoveryRouter = Router();

/**
 * TEMP in-memory store for speed.
 * Later move to DB: discovered_devices table.
 */
const store: Record<string, any[]> = {}; // siteId -> devices[]

/**
 * Edge Agent pushes discovered devices here.
 * Body: { site_id: string, agent_id: string, devices: any[] }
 */
edgeDiscoveryRouter.post("/edge/discovery/push", (req, res) => {
  const { site_id, agent_id, devices } = req.body || {};
  if (!site_id || !agent_id || !Array.isArray(devices)) {
    return res.status(400).json({ error: "site_id, agent_id, devices[] required" });
  }

  // Save latest list
  store[site_id] = devices.map((d) => ({
    ...d,
    agent_id,
    last_seen_at: new Date().toISOString(),
  }));

  return res.json({ ok: true, site_id, count: store[site_id].length });
});

/**
 * Facility UI pulls discovered devices from here.
 */
edgeDiscoveryRouter.get("/edge/discovery/:siteId", (req, res) => {
  const siteId = req.params.siteId;
  return res.json({ site_id: siteId, devices: store[siteId] || [] });
});
