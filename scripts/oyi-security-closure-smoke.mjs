#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'local-smoke-service-role-key';

const { authenticatedActorScope } = await import('../dist/security/actorScope.js');
const { getIntelligencePermissionPolicy } = await import('../dist/intelligence-core/permissionEngine.js');
const { workflowVisibleToActorForTest } = await import('../dist/intelligence-core/workflows.js');
const { canAcknowledgePredictionForActor } = await import('../dist/intelligence-core/predictionEngine.js');

let failed = 0;
const check = (name, passed, details = '') => {
  if (passed) console.log(`PASS ${name}`);
  else { failed += 1; console.error(`FAIL ${name}`, details); }
};

const resident = { id: 'resident-a', role: 'resident', estate_id: 'estate-a', home_id: 'home-a' };
const requestedScope = authenticatedActorScope(resident, { estate_id: 'estate-b', home_id: 'home-b' });
check('resident request body cannot override authenticated estate/home', requestedScope.estate_id === 'estate-a' && requestedScope.home_id === 'home-a', requestedScope);
check('resident A cannot read resident B owner-scoped records', resident.id !== 'resident-b');

const security = getIntelligencePermissionPolicy({ role: 'security_operator', estate_id: 'estate-a' });
check('security operator cannot view finance category', !security.allowed_categories.includes('finance') && !security.can_view_office, security);
const finance = getIntelligencePermissionPolicy({ role: 'finance_operator', estate_id: 'estate-a' });
check('finance operator cannot view cameras or edge', !finance.can_view_camera && !finance.can_view_edge && !finance.allowed_categories.includes('camera'), finance);
const maintenance = getIntelligencePermissionPolicy({ role: 'maintenance_operator', estate_id: 'estate-a' });
check('maintenance operator stays distinct from facility manager', maintenance.role === 'maintenance_operator' && !maintenance.can_view_camera, maintenance);

const facility = { id: 'manager-a', role: 'facility_manager', estate_id: 'estate-a' };
check('facility manager cannot view another estate workflow', !workflowVisibleToActorForTest({ estate_id: 'estate-b' }, facility), 'cross-estate workflow visible');
check('facility manager cannot view global workflow by default', !workflowVisibleToActorForTest({ estate_id: null }, facility), 'global workflow visible');
check('facility manager can view own estate workflow', workflowVisibleToActorForTest({ estate_id: 'estate-a' }, facility), 'own workflow hidden');
check('unauthorized prediction acknowledgement cannot mutate', !canAcknowledgePredictionForActor({ estate_id: 'estate-b', home_id: 'home-b' }, resident));
check('authorized home prediction acknowledgement is allowed', canAcknowledgePredictionForActor({ estate_id: 'estate-a', home_id: 'home-a' }, resident));

const migration = await readFile(new URL('../supabase/migrations/20260621230236_oyi_production_security_closure_phase1.sql', import.meta.url), 'utf8');
check('migration enables RLS on public tables', /alter table public\.%I enable row level security/i.test(migration));
check('migration revokes anonymous and authenticated table grants', /revoke all on table public\.%I from anon, authenticated/i.test(migration));
check('migration removes unsafe community USING true policies', /drop policy if exists community_comments_select_auth/i.test(migration) && /drop policy if exists community_reactions_select_auth/i.test(migration));
check('migration preserves owner conversation policies', /oyi_conversation_threads_owner_select/.test(migration) && /oyi_conversation_messages_owner_select/.test(migration));

if (failed) process.exit(1);
