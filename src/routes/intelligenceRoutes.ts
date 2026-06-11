import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { INTELLIGENCE_AGENTS } from "../intelligence-core/agentRegistry";
import { INTELLIGENCE_TOOL_REGISTRY, getToolsForAgent } from "../intelligence-core/toolRegistry";
import { getMemoryDirectory } from "../intelligence-core/memoryDirectory";
import { listPersistedIntelligenceEvents, summarizeIntelligenceEvents, type IntelligenceEventFilters } from "../intelligence-core/eventBus";
import { loadNormalizedTimelineEvents } from "../intelligence-core/normalizers";

const router = Router();

function parseLimit(raw: unknown, fallback = 50) {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(200, n));
}

function buildFilters(req: any): IntelligenceEventFilters {
  const user = req.user || null;
  const estateId = req.query.estate_id ? String(req.query.estate_id) : user?.estate_id || null;
  const homeId = req.query.home_id ? String(req.query.home_id) : user?.home_id || null;
  return {
    actor: user,
    agent_id: req.query.agent_id ? String(req.query.agent_id) : null,
    category: req.query.category ? String(req.query.category) : null,
    estate_id: estateId,
    home_id: homeId,
    camera_id: req.query.camera_id ? String(req.query.camera_id) : null,
    limit: parseLimit(req.query.limit, 50),
  };
}

router.get("/agents", requireAuth, (req, res) => {
  const user = req.user as any;
  const agents = INTELLIGENCE_AGENTS.map((agent) => ({
    ...agent,
    tools_registered: getToolsForAgent(agent.id).length,
    memory_directory: getMemoryDirectory(agent.id).map((entry) => ({
      scope: entry.scope,
      owner_hint: entry.owner_hint,
      visibility: entry.visibility,
      boundary: entry.boundary,
      storage: entry.storage,
    })),
  }));

  return res.json({
    ok: true,
    core_id: "ochiga_intelligence_core",
    actor_scope: {
      user_id: user?.id || null,
      estate_id: user?.estate_id || null,
      home_id: user?.home_id || null,
    },
    agents,
    tools_registered: INTELLIGENCE_TOOL_REGISTRY.length,
  });
});

router.get("/events", requireAuth, async (req, res) => {
  const filters = buildFilters(req);
  const [persisted, normalized] = await Promise.all([
    listPersistedIntelligenceEvents(filters),
    loadNormalizedTimelineEvents(filters),
  ]);

  const byKey = new Map<string, any>();
  for (const event of [...(persisted.events || []), ...(normalized.events || [])]) {
    const key = String(event.id || `${event.metadata?.source_table || event.source}:${event.metadata?.source_event_id || event.occurred_at}:${event.title}`);
    if (!byKey.has(key)) byKey.set(key, event);
  }

  const events = Array.from(byKey.values())
    .sort((a, b) => new Date(b.occurred_at || b.created_at).getTime() - new Date(a.occurred_at || a.created_at).getTime())
    .slice(0, parseLimit(req.query.limit, 50));

  return res.json({
    ok: true,
    events,
    warnings: [persisted.warning, ...(normalized.warnings || [])].filter(Boolean),
  });
});

router.get("/summary", requireAuth, async (req, res) => {
  const filters = buildFilters(req);
  const [persisted, normalized] = await Promise.all([
    listPersistedIntelligenceEvents({ ...filters, limit: parseLimit(req.query.limit, 100) }),
    loadNormalizedTimelineEvents({ ...filters, limit: parseLimit(req.query.limit, 100) }),
  ]);

  const byKey = new Map<string, any>();
  for (const event of [...(persisted.events || []), ...(normalized.events || [])]) {
    const key = String(event.id || `${event.metadata?.source_table || event.source}:${event.metadata?.source_event_id || event.occurred_at}:${event.title}`);
    if (!byKey.has(key)) byKey.set(key, event);
  }
  const events = Array.from(byKey.values()).sort((a, b) => new Date(b.occurred_at || b.created_at).getTime() - new Date(a.occurred_at || a.created_at).getTime());

  return res.json({
    ok: true,
    summary: summarizeIntelligenceEvents(events),
    memory_directory: getMemoryDirectory().map((entry) => ({
      scope: entry.scope,
      agents: entry.agents,
      visibility: entry.visibility,
      boundary: entry.boundary,
    })),
    warnings: [persisted.warning, ...(normalized.warnings || [])].filter(Boolean),
  });
});

export default router;
