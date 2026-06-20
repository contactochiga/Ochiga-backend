#!/usr/bin/env node
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'local-smoke-service-role-key';

const { classifyOyiOperatingIntentForTest, buildOyiAwarenessScenarioForTest, resolveOyiDomainIntentForTest } = await import('../dist/services/oyiUnifiedIntelligenceService.js');

const cases = [
  ['What’s happening?', 'awareness'],
  ['What can you do?', 'capability_query'],
  ['Turn off the living room light', 'device_control'],
  ['Show all offline devices', 'device_status'],
  ['Approve visitor', 'visitor_operation'],
  ['Show pending visitors', 'visitor_operation'],
  ['Show visitor requests', 'visitor_operation'],
  ['Show visitor access', 'visitor_operation'],
  ['Add Michel as visitor', 'visitor_operation'],
  ['Show open maintenance', 'maintenance_operation'],
  ['Show maintenance issues', 'maintenance_operation'],
  ['Show maintenance requests', 'maintenance_operation'],
  ['Show maintainance requests', 'maintenance_operation'],
  ['Generate daily estate report', 'report_generation'],
  ['Show wallet balance', 'wallet_operation'],
  ['Who opened the gate?', 'investigation'],
  ['What changed overnight?', 'awareness'],
];

const domainCases = [
  ['consumer', 'Show visitor requests', 'visitors'], ['consumer', 'Add Michael as visitor', 'visitors'], ['consumer', 'Show maintenance requests', 'maintenance'],
  ['consumer', 'Show maintainance requests', 'maintenance'],
  ['consumer', 'Show devices', 'devices'], ['consumer', 'Show rooms', 'rooms'], ['consumer', 'Show scenes', 'scenes'], ['consumer', 'Show automations', 'automation'],
  ['consumer', 'Show services', 'services'], ['consumer', 'Show wallet', 'wallet'], ['consumer', 'Show community updates', 'community'], ['consumer', 'Show notifications', 'notifications'],
  ['consumer', 'Show activity', 'activity'], ['consumer', 'Show security', 'security'], ['consumer', 'Show utilities', 'utilities'],
  ['facility', 'Show visitor access', 'visitors'], ['facility', 'Show maintenance issues', 'maintenance'], ['facility', 'Show device health', 'devices'],
  ['facility', 'Open most recent requests', 'operational_queue'], ['facility', 'Open operator request', 'operational_queue'], ['facility', 'Open most important issue', 'operational_queue'], ['facility', 'Show pending tasks', 'operational_queue'], ['facility', 'Show assigned tasks', 'operational_queue'],
  ['facility', 'Show active workflows', 'workflows'], ['facility', 'Open pending workflows', 'workflows'],
  ['facility', 'Show cameras', 'cameras'], ['facility', 'Show infrastructure', 'infrastructure'], ['facility', 'Show utilities', 'utilities'], ['facility', 'Show sensors', 'sensors'],
  ['facility', 'Show traffic', 'traffic'], ['facility', 'Show community reports', 'community'], ['facility', 'Show wallet operations', 'wallet'], ['facility', 'Show staff', 'staff'],
  ['facility', 'Show reports', 'reports'], ['facility', 'Show estate structure', 'estate'], ['facility', 'Show activity timeline', 'activity'], ['facility', 'Show notifications', 'notifications'],
];

let failed = 0;
for (const [prompt, expected] of cases) {
  const actual = classifyOyiOperatingIntentForTest(prompt);
  if (actual !== expected) {
    failed += 1;
    console.error(`FAIL intent: ${prompt} expected ${expected}, got ${actual}`);
  } else {
    console.log(`PASS intent: ${prompt} -> ${actual}`);
  }
}

for (const [surface, prompt, expectedDomain] of domainCases) {
  const resolved = resolveOyiDomainIntentForTest(prompt, surface);
  if (resolved.domain !== expectedDomain || resolved.awareness_fallback_used) {
    failed += 1;
    console.error(`FAIL domain: ${surface} ${prompt}`, resolved);
  } else {
    console.log(`PASS domain: ${surface} ${prompt} -> ${resolved.domain}`);
  }
}

const calm = buildOyiAwarenessScenarioForTest({ surface: 'consumer', message: 'What’s happening?', events: [] });
if (!/operating normally/i.test(calm.message) || calm.awareness.severity !== 'normal') {
  failed += 1;
  console.error('FAIL calm awareness response', calm);
} else {
  console.log(`PASS calm awareness: ${calm.message}`);
}

if (failed) process.exit(1);
