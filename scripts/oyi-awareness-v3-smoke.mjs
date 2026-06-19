#!/usr/bin/env node
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'local-smoke-service-role-key';

const { buildOyiAwarenessScenarioForTest } = await import('../dist/services/oyiUnifiedIntelligenceService.js');

const now = new Date().toISOString();
const event = (overrides) => ({ occurred_at: now, created_at: now, source: 'smoke', ...overrides });

const scenarios = [
  {
    name: 'consumer normal device events stay calm',
    surface: 'consumer',
    message: "What's happening?",
    events: [event({ event_type: 'device_command_executed', title: 'Device Command Executed', summary: 'Living room switch turned on successfully.', status: 'success' })],
    expect: { severity: 'normal', headline: /operating normally/i, message: /no security|operating normally/i },
  },
  {
    name: 'consumer visitor pending ranks visitor attention',
    surface: 'consumer',
    message: 'What needs attention?',
    events: [event({ event_type: 'visitor_created', title: 'Visitor awaiting approval', summary: 'A visitor is pending approval.', status: 'pending' })],
    expect: { severity: 'attention', headline: /visitor/i, message: /pending visitor|visitor/i },
  },
  {
    name: 'consumer maintenance open ranks maintenance',
    surface: 'consumer',
    message: 'What should I do next?',
    events: [event({ event_type: 'maintenance_updated', title: 'Maintenance request open', summary: 'AC request remains open.', status: 'open' })],
    expect: { severity: 'attention', headline: /maintenance/i, message: /maintenance/i },
  },
  {
    name: 'consumer security event ranks critical',
    surface: 'consumer',
    message: 'What needs attention?',
    events: [event({ category: 'security', event_type: 'security_breach', title: 'Security breach detected', summary: 'Unauthorized access attempt detected.', severity: 'critical' })],
    expect: { severity: 'critical', headline: /security/i, message: /security/i },
  },
  {
    name: 'facility only AI internal events stay calm',
    surface: 'facility',
    message: "What's happening?",
    events: [event({ event_type: 'ai_response_generated', title: 'AI Response Generated', summary: 'Assistant response persisted.' })],
    expect: { severity: 'normal', headline: /operations are stable/i, message: /stable/i },
  },
  {
    name: 'facility open maintenance ranks maintenance',
    surface: 'facility',
    message: 'What needs attention?',
    events: [event({ event_type: 'maintenance_updated', title: 'Generator maintenance open', summary: 'Generator issue remains open.', status: 'open' })],
    expect: { severity: 'attention', headline: /maintenance/i, message: /assign|maintenance|follow up/i },
  },
  {
    name: 'facility offline infrastructure outranks routine activity',
    surface: 'facility',
    message: 'What needs attention?',
    events: [
      event({ event_type: 'device_command_executed', title: 'Device Command Executed', summary: 'Light switch updated successfully.', status: 'success' }),
      event({ event_type: 'edge_runtime_offline', title: 'Edge runtime offline', summary: 'Infrastructure component is offline.', status: 'offline' }),
    ],
    expect: { severity: 'warning', headline: /infrastructure/i, message: /infrastructure|offline/i },
  },
  {
    name: 'facility pending visitor ranks access attention',
    surface: 'facility',
    message: 'What should I do next?',
    events: [event({ event_type: 'visitor_access_requested', title: 'Visitor access pending', summary: 'Visitor access request is pending.', status: 'pending' })],
    expect: { severity: 'attention', headline: /visitor/i, message: /visitor/i },
  },
];

let failed = 0;
for (const scenario of scenarios) {
  const result = buildOyiAwarenessScenarioForTest(scenario);
  const awareness = result.awareness;
  const checks = [
    [awareness.severity === scenario.expect.severity, `expected severity ${scenario.expect.severity}, got ${awareness.severity}`],
    [scenario.expect.headline.test(awareness.headline), `unexpected headline: ${awareness.headline}`],
    [scenario.expect.message.test(result.message), `unexpected message: ${result.message}`],
  ];
  const error = checks.find(([ok]) => !ok);
  if (error) {
    failed += 1;
    console.error(`FAIL ${scenario.name}: ${error[1]}`);
    console.error(JSON.stringify({ awareness, message: result.message }, null, 2));
  } else {
    console.log(`PASS ${scenario.name}: ${awareness.headline} (${awareness.severity}, score ${awareness.awareness_score})`);
  }
}

if (failed) process.exit(1);
