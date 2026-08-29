-- Cross-Domain Operational Automation.
--
-- automation_approvals.entity_id was `not null`, which fit every action
-- that existed when the table was created (visitor.*/maintenance.* --
-- both mutate one concrete, existing row). This pass adds
-- notification.notify, the first registered action with no single
-- target row to reference (it addresses a role/user/home/estate, not an
-- entity) -- so entity_id must become nullable to represent it honestly,
-- rather than writing a synthetic/fake id into a column that means
-- "the real row this approval will mutate."
--
-- Purely additive: every existing row already has a real, non-null
-- entity_id and is completely unaffected. The one-pending-per-target
-- unique index (estate_id, action_id, entity_id) already treats NULL as
-- distinct per standard SQL semantics, so it continues to prevent
-- duplicate proposals for entity-bearing actions exactly as before, and
-- simply does not collide two unrelated notification proposals with
-- each other (which is correct -- they are not "the same target").
alter table automation_approvals
  alter column entity_id drop not null;
