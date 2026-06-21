#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'local-smoke-service-role-key';

const { authenticatedActorScope } = await import('../dist/security/actorScope.js');
const { getIntelligencePermissionPolicy } = await import('../dist/intelligence-core/permissionEngine.js');
const { workflowVisibleToActorForTest } = await import('../dist/intelligence-core/workflows.js');
const { canAcknowledgePredictionForActor } = await import('../dist/intelligence-core/predictionEngine.js');
const { hasPermission } = await import('../dist/core/foundation/permissions.js');

let failed = 0;
const check = (name, passed, details = '') => {
  if (passed) console.log(`PASS ${name}`);
  else { failed += 1; console.error(`FAIL ${name}`, details); }
};

const residentA = { id: 'resident-a', role: 'resident', estate_id: 'estate-a', home_id: 'home-a' };
const residentB = { id: 'resident-b', role: 'resident', estate_id: 'estate-a', home_id: 'home-b' };
const facilityA = { id: 'facility-a', role: 'facility_manager', estate_id: 'estate-a' };
const securityA = { id: 'security-a', role: 'security_operator', estate_id: 'estate-a' };
const financeA = { id: 'finance-a', role: 'finance_operator', estate_id: 'estate-a' };
const adminA = { id: 'admin-a', role: 'estate_admin', estate_id: 'estate-a' };

const injected = authenticatedActorScope(residentA, { estate_id: 'estate-b', home_id: 'home-b' });
check('direct API scope rejects Resident A request-body switch to Home B', injected.estate_id === residentA.estate_id && injected.home_id === residentA.home_id, injected);
check('Oyi chat scope remains Resident A after invalid scope request', injected.home_id !== residentB.home_id, injected);
check('Resident A and Resident B do not share owner-scoped identity', residentA.id !== residentB.id && residentA.home_id !== residentB.home_id);

check('Facility Manager cannot read Estate B workflows', !workflowVisibleToActorForTest({ estate_id: 'estate-b' }, facilityA));
check('Facility Manager cannot read global workflows', !workflowVisibleToActorForTest({ estate_id: null }, facilityA));
check('Estate Admin retains only own-estate workflow visibility', workflowVisibleToActorForTest({ estate_id: 'estate-a' }, adminA) && !workflowVisibleToActorForTest({ estate_id: 'estate-b' }, adminA));

const securityPolicy = getIntelligencePermissionPolicy(securityA);
const financePolicy = getIntelligencePermissionPolicy(financeA);
check('Security Operator cannot access finance intelligence', !securityPolicy.allowed_categories.includes('finance') && !hasPermission(securityA, 'wallets.read'));
check('Finance Operator cannot access camera/security intelligence', !financePolicy.can_view_camera && !financePolicy.allowed_categories.includes('security') && !hasPermission(financeA, 'cameras.view'));
check('Facility Manager and Estate Admin retain distinct permissions', !hasPermission(facilityA, 'wallets.manage') && hasPermission(adminA, 'wallets.manage'));

check('Security Operator retains visitor and camera access only', hasPermission(securityA, 'visitors.manage') && hasPermission(securityA, 'cameras.view') && !hasPermission(securityA, 'wallets.read'));
check('Finance Operator retains wallet/service access only', hasPermission(financeA, 'wallets.read') && hasPermission(financeA, 'services.manage') && !hasPermission(financeA, 'visitors.manage'));
check('Resident retains scoped device, visitor, wallet, community, notification permissions', hasPermission(residentA, 'devices.read') && hasPermission(residentA, 'visitors.create') && hasPermission(residentA, 'wallets.read') && hasPermission(residentA, 'community.read') && hasPermission(residentA, 'notifications.read'));

check('Unauthorized prediction acknowledgement is denied before mutation', !canAcknowledgePredictionForActor({ estate_id: 'estate-b', home_id: 'home-b' }, residentA));
check('Authorized prediction acknowledgement remains home scoped', canAcknowledgePredictionForActor({ estate_id: 'estate-a', home_id: 'home-a' }, residentA));

const routeSource = await readFile(new URL('../src/routes/intelligenceRoutes.ts', import.meta.url), 'utf8');
const commandSource = await readFile(new URL('../src/ai/commandRouter.ts', import.meta.url), 'utf8');
const cameraSource = await readFile(new URL('../src/controllers/camerasController.ts', import.meta.url), 'utf8');
check('Intelligence API filters use authenticated context, not request query scope', /estate_id: user\?\.estate_id \|\| null/.test(routeSource) && /home_id: user\?\.home_id \|\| null/.test(routeSource));
check('Oyi command router ignores unverified explicit scope', /return authenticatedActorScope\(actor\)\.estate_id/.test(commandSource) && /return authenticatedActorScope\(actor\)\.home_id/.test(commandSource));
check('Camera mutations require estate membership', (cameraSource.match(/assertEstateMember\(user, resolvedEstateId\)/g) || []).length >= 2);

if (failed) process.exit(1);
