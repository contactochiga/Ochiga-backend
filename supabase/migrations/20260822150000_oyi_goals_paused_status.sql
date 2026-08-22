-- Adds "paused" to oyi_goals.status -- the safety-control pause/resume
-- state (Part N). Deliberately excluded from GOAL_DUE_STATUSES: a
-- paused goal is skipped by both the scheduler's due-scan (listDue) and
-- the event-driven wake path (findGoalsWatchingThread), so it neither
-- polls nor reacts to an inbound reply until explicitly resumed.

begin;

alter table public.oyi_goals drop constraint if exists oyi_goals_status_check;

alter table public.oyi_goals add constraint oyi_goals_status_check check (status in (
  'understood', 'proposed', 'confirmed', 'active', 'observing',
  'action_due', 'executing', 'verifying', 'waiting', 'reevaluating', 'paused',
  'completed', 'blocked', 'failed', 'cancelled', 'expired', 'needs_human'
));

commit;
