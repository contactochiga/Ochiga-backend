-- Reconciles the MCP fallback applied after the CLI pooler timed out.
alter table if exists public.consumer_scenes
  add column if not exists description text;
