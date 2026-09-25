-- Wave 7 Slice 2: Identity-Chain Repair -- goal lineage back-reference.
--
-- Nullable, additive, no FK. NULL is the honest answer for every goal
-- that isn't signal-driven (conversational proposal, manual goal, or a
-- pre-existing goal created before this column existed) -- never
-- back-filled. Same column name and type as
-- public.operational_signals.canonical_signal_key (the established
-- convention for this identity, see
-- 20260728143000_oyi_core_convergence_canonical_storage.sql) so the
-- concept reads identically across tables. Deliberately no FK: goal
-- creation and canonical-signal materialization are two independent,
-- unordered write paths (see officeMaterialEventAdapter.ts's
-- fire-and-forget activateDevelopmentRelationshipGoal, which runs before
-- submitCanonicalSignal's own registerMaterialization commits), so a
-- goal's canonical_signal_key may reference a signal not yet -- or never
-- -- persisted to operational_signals; a hard FK would make an
-- ordering artifact into a write failure. Plain (non-unique) index only,
-- for lineage lookups ("which goals trace back to this signal"), not a
-- dedup/identity constraint -- a signal may legitimately motivate more
-- than one goal over time (e.g. a cancelled goal followed by a fresh
-- one).

begin;

alter table public.oyi_goals
  add column if not exists canonical_signal_key text;

create index if not exists idx_oyi_goals_canonical_signal_key
  on public.oyi_goals(canonical_signal_key)
  where canonical_signal_key is not null;

commit;
