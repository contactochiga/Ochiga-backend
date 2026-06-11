import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { INTELLIGENCE_AGENTS } from "../intelligence-core/agentRegistry";
import { INTELLIGENCE_TOOL_REGISTRY, getToolsForAgent } from "../intelligence-core/toolRegistry";
import { getMemoryDirectory } from "../intelligence-core/memoryDirectory";
import { listPersistedIntelligenceEvents, type IntelligenceEventFilters } from "../intelligence-core/eventBus";
import { loadNormalizedTimelineEvents } from "../intelligence-core/normalizers";
import { applyRoleScopeToFilters, filterEventsForActor, getIntelligencePermissionPolicy } from "../intelligence-core/permissionEngine";
import { buildIntelligenceSummary, inferSummaryType, type IntelligenceSummaryType } from "../intelligence-core/summaryEngine";
import { AGENT_COLLABORATION_RULES, getCollaborationHints } from "../intelligence-core/collaboration";
import { getIntelligenceHealth } from "../intelligence-core/health";
import { observeAgentAction } from "../intelligence-core/observability";

const router = Router();

function parseLimit(raw: unknown, fallback = 50) {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(200, n));
}

function summaryType(raw: unknown, fallback: IntelligenceSummaryType): IntelligenceSummaryType {
  const value = String(raw || "").trim().toLowerCase();
  return ["consumer", "facility", "office", "watch", "camera", "edge"].includes(value) ? (value as IntelligenceSummaryType) : fallback;
}

function buildFilters(req: any): IntelligenceEventFilters {
  const user = req.user || null;
  const base = {
    actor: user,
    agent_id: req.query.agent_id ? String(req.query.agent_id) : null,
    category: req.query.category ? String(req.query.category) : null,
    estate_id: req.query.estate_id ? String(req.query.estate_id) : user?.estate_id || null,
    home_id: req.query.home_id ? String(req.query.home_id) : user?.home_id || null,
    camera_id: req.query.camera_id ? String(req.query.camera_id) : null,
    limit: parseLimit(req.query.limit, 50),
  };
  return applyRoleScopeToFilters(base, user);
}

function mergeEvents(persisted: any[], normalized: any[], limit: number) {
  const byKey = new Map<string, any>();
  for (const event of [...persisted, ...normalized]) {
    const key = String(event.id || `${event.metadata?.source_table || event.source}:${event.metadata?.source_event_id || event.occurred_at}:${event.title}`);
    if (!byKey.has(key)) byKey.set(key, event);
  }
  return Array.from(byKey.values())
    .sort((a, b) => new Date(b.occurred_at || b.created_at).getTime() - new Date(a.occurred_at || a.created_at).getTime())
    .slice(0, limit);
}

async function loadRoleAwareEvents(req: any, limitFallback = 50) {
  const filters = buildFilters(req);
  const limit = parseLimit(req.query.limit, limitFallback);
  const [persisted, normalized] = await Promise.all([
    listPersistedIntelligenceEvents({ ...filters, limit }),
    loadNormalizedTimelineEvents({ ...filters, limit }),
  ]);
  const merged = mergeEvents(persisted.events || [], normalized.events || [], limit);
  const roleFiltered = filterEventsForActor(merged, req.user || null);
  return {
    events: roleFiltered,
    filters,
    warnings: [persisted.warning, ...(normalized.warnings || [])].filter(Boolean),
  };
}

router.get("/agents", requireAuth, async (req, res) => {
  const started = Date.now();
  try {
    const body = await observeAgentAction(
      { agent_id: "facility", action: "intelligence.agents", tool: "intelligence:agents", surface: "api", actor: req.user },
      async () => {
        const user = req.user as any;
        const policy = getIntelligencePermissionPolicy(user);
        const agents = INTELLIGENCE_AGENTS
          .filter((agent) => policy.allowed_agents.includes(agent.id))
          .map((agent) => ({
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

        return {
          ok: true,
          core_id: "ochiga_intelligence_core",
          actor_scope: {
            user_id: user?.id || null,
            estate_id: user?.estate_id || null,
            home_id: user?.home_id || null,
            role: policy.role,
          },
          agents,
          collaboration_rules: AGENT_COLLABORATION_RULES,
          tools_registered: INTELLIGENCE_TOOL_REGISTRY.length,
          latency_ms: Date.now() - started,
        };
      }
    );
    return res.json(body);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load intelligence agents" });
  }
});

router.get("/events", requireAuth, async (req, res) => {
  try {
    const body = await observeAgentAction(
      { agent_id: "oyi", action: "intelligence.events", tool: "intelligence:events", surface: "api", actor: req.user },
      async () => {
        const { events, warnings } = await loadRoleAwareEvents(req, 50);
        return {
          ok: true,
          events,
          role_policy: getIntelligencePermissionPolicy(req.user || null),
          collaboration_hints: getCollaborationHints(events),
          warnings,
        };
      }
    );
    return res.json(body);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load intelligence events" });
  }
});

router.get("/summary", requireAuth, async (req, res) => {
  try {
    const body = await observeAgentAction(
      { agent_id: "oyi", action: "intelligence.summary", tool: "intelligence:summary", surface: "api", actor: req.user },
      async () => {
        const { events, warnings } = await loadRoleAwareEvents(req, 100);
        const type = summaryType(req.query.type, inferSummaryType(req.user || null));
        return {
          ok: true,
          summary: buildIntelligenceSummary(type, events, req.user || null),
          collaboration_hints: getCollaborationHints(events),
          memory_directory: getMemoryDirectory().map((entry) => ({
            scope: entry.scope,
            agents: entry.agents,
            visibility: entry.visibility,
            boundary: entry.boundary,
          })),
          warnings,
        };
      }
    );
    return res.json(body);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to build intelligence summary" });
  }
});

router.get("/health", requireAuth, async (req, res) => {
  try {
    const body = await observeAgentAction(
      { agent_id: "edge", action: "intelligence.health", tool: "intelligence:health", surface: "api", actor: req.user },
      async () => getIntelligenceHealth()
    );
    return res.json(body);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load intelligence health" });
  }
});

export default router;
