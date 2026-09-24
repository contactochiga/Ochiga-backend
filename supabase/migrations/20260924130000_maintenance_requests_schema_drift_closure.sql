begin;

-- Wave 6 Final B -- maintenance_requests schema drift closure.
--
-- resident_id, category, priority, and membership_id have been submitted
-- on every consumer/Facility maintenance-request create since at least
-- Programme 4 Phase L (src/controllers/maintenance.controller.ts,
-- src/oyi-core/domains/maintenance/maintenanceEvidence.ts), but no tracked
-- migration ever created these columns on maintenance_requests. Writers
-- silently dropped them via insertWithSchemaFallback's missing-column
-- retry, so every submitted category/priority/resident linkage was lost.
-- Consumer GET /maintenance (listMyMaintenance) filters directly on
-- `.eq("resident_id", userId)` -- with the column absent, that query has
-- always matched zero rows, so residents could never see their own
-- maintenance requests through that endpoint. This is a real, actively
-- broken production defect, not speculative schema.
--
-- Additive only: nullable, no defaults beyond what is already implied by
-- existing code (writers already default priority to "medium" at the
-- application layer). No existing column, index, or constraint is
-- modified. `user_id` (the original requester/creator column) is left
-- untouched -- resident_id is a distinct, already-relied-upon field
-- (src/routes/activity.ts's own fallback chain already treats
-- resident_id and user_id as separate possible sources).
alter table public.maintenance_requests
  add column if not exists resident_id uuid references public.users(id) on delete set null,
  add column if not exists category text,
  add column if not exists priority text,
  add column if not exists membership_id uuid references public.home_memberships(id) on delete set null;

create index if not exists idx_maintenance_requests_resident on public.maintenance_requests(resident_id);

commit;
