#!/usr/bin/env node
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'local-smoke-service-role-key';

const { classifyOyiOperatingIntentForTest, buildOyiAwarenessScenarioForTest } = await import('../dist/services/oyiUnifiedIntelligenceService.js');

const cases = [
  ['What’s happening?', 'awareness'],
  ['What can you do?', 'capability_query'],
  ['Turn off the living room light', 'device_control'],
  ['Show all offline devices', 'device_status'],
  ['Approve visitor', 'visitor_operation'],
  ['Show pending visitors', 'visitor_operation'],
  ['Show open maintenance', 'maintenance_operation'],
  ['Generate daily estate report', 'report_generation'],
  ['Show wallet balance', 'wallet_operation'],
  ['Who opened the gate?', 'investigation'],
  ['What changed overnight?', 'awareness'],
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

const calm = buildOyiAwarenessScenarioForTest({ surface: 'consumer', message: 'What’s happening?', events: [] });
if (!/operating normally/i.test(calm.message) || calm.awareness.severity !== 'normal') {
  failed += 1;
  console.error('FAIL calm awareness response', calm);
} else {
  console.log(`PASS calm awareness: ${calm.message}`);
}

if (failed) process.exit(1);
