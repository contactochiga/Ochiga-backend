-- Wave 6 Slice 3 -- minimum scope-coverage closure for operational_awareness.
--
-- Slice 2 proved operational_awareness has no estate_id/home_id of its own,
-- and that buildAwarenessFromSignal() persists a row for every accepted
-- canonical signal regardless of whether correlateIncident() produced an
-- incident (it intentionally returns null for command-lifecycle acks,
-- user-initiated "off" actions, expired-only pings, audit-recursion, and
-- routine private-info-severity signals). Those incident-less rows had no
-- trustworthy persisted scope relationship, so the canonical read service
-- correctly excluded them and reported the exclusion via
-- coverageGap.scopeUnresolvedExcluded rather than guessing.
--
-- This migration adds the smallest authoritative relationship: the same
-- estate_id/home_id values already computed and already written onto
-- operational_recommendations/operational_incidents at signal-processing
-- time (signal.estateId / homeIdFromSignal(signal) in
-- canonicalIntelligenceStore.ts), now also written onto
-- operational_awareness directly. No new signal/entity/payload parsing is
-- introduced; this is a straight columnar echo of normalized canonical
-- signal truth that the write path already possesses at the moment it
-- persists the row.
--
-- Both columns are nullable and additive. Existing rows are NOT guessed at:
-- rows with a resolvable incident_id are backfilled from
-- operational_incidents' own estate_id/home_id (a provable, already-trusted
-- relationship -- not fabrication). Rows with incident_id null remain
-- untouched (still null) -- their historical scope is honestly unknown and
-- stays that way; the canonical read service continues to exclude and
-- report them via the same coverage-gap accounting, now scoped to rows
-- that predate this migration or predate an application deploy that writes
-- the new columns.

alter table public.operational_awareness
  add column if not exists estate_id uuid references public.estates(id) on delete set null,
  add column if not exists home_id uuid references public.homes(id) on delete set null;

create index if not exists idx_operational_awareness_estate_id on public.operational_awareness (estate_id);
create index if not exists idx_operational_awareness_home_id on public.operational_awareness (home_id);

-- Trustworthy backfill: only for rows whose incident_id already resolves to
-- a real operational_incidents row with known scope. This is the exact
-- relationship Slice 2's read service already used to resolve scope for
-- these rows -- persisting it directly is a performance/coverage
-- normalization, not a new trust decision.
update public.operational_awareness aw
set
  estate_id = inc.estate_id,
  home_id = inc.home_id
from public.operational_incidents inc
where aw.incident_id = inc.id
  and aw.estate_id is null
  and aw.home_id is null;
