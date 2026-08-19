begin;

-- Oyi Cross-Surface Observability Closure — extends the existing
-- ochiga_intelligence_events table (already the canonical cross-surface
-- event sink used by workflows/camera-intel/edge-discovery) with the
-- minimal columns Office's AI Agents observability page genuinely needs
-- and cannot derive from the existing generic `metadata jsonb` blob
-- without an unindexed JSON scan: interaction mode, execution status,
-- capability/tool identity, conversation/request correlation, and
-- latency. No new table — this is a projection/normalization layer
-- over already-authoritative source records (conversation orchestrator
-- persistence, communications_events, ai_execution_ledger), not a
-- second operational database.

alter table if exists ochiga_intelligence_events add column if not exists mode text;
alter table if exists ochiga_intelligence_events add column if not exists status text;
alter table if exists ochiga_intelligence_events add column if not exists capability text;
alter table if exists ochiga_intelligence_events add column if not exists tool text;
alter table if exists ochiga_intelligence_events add column if not exists conversation_id text;
alter table if exists ochiga_intelligence_events add column if not exists request_id text;
alter table if exists ochiga_intelligence_events add column if not exists latency_ms integer;

-- Only ONE index added: GET /office/observability/events (officeExport.ts)
-- runs exactly `where source = 'oyi_observability_bridge' order by
-- occurred_at desc limit N` — this composite index is what that query
-- actually needs. surface/mode/status filtering happens client-side in
-- Office today (same pattern as its own traces table), so indexes for
-- those columns would back no real query yet — deliberately not added;
-- add them later if/when a real server-side filter by those columns
-- exists. conversation_id/request_id are read but never filtered/joined
-- on by any query today (Office correlates client-side), so no index
-- for those either.
create index if not exists idx_ochiga_intelligence_events_source_time on ochiga_intelligence_events(source, occurred_at desc);

commit;
