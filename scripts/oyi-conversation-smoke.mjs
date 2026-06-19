#!/usr/bin/env node
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'local-smoke-service-role-key';

const { resolveConversationFollowUpForTest } = await import('../dist/services/oyiUnifiedIntelligenceService.js');

const state = {
  last_intent: 'visitor_operation',
  last_user_message: 'Show pending visitors',
  entities: [
    { type: 'visitor', id: 'visitor-1', title: 'Ada Okafor', status: 'pending' },
    { type: 'visitor', id: 'visitor-2', title: 'Tunde Bello', status: 'pending' },
  ],
  pending_confirmation_id: 'ledger-1',
};

const cases = [
  ['Approve the first one.', (value) => value.is_follow_up && value.entity?.id === 'visitor-1'],
  ['Why?', (value) => value.intent === 'investigation' && /Ada Okafor/.test(value.expanded_message)],
  ['When?', (value) => value.intent === 'investigation' && /last updated/.test(value.expanded_message)],
  ['Who?', (value) => value.intent === 'investigation' && /associated/.test(value.expanded_message)],
  ['Show me more.', (value) => value.expanded_message === 'Show pending visitors'],
  ['Do it.', (value) => value.pending_confirmation_id === 'ledger-1'],
];

const subsystemCases = [
  ['device', { last_intent: 'device_status', entities: [{ type: 'device', id: 'device-1', title: 'Living Room Light' }] }, 'Why?', 'device'],
  ['maintenance', { last_intent: 'maintenance_operation', entities: [{ type: 'maintenance', id: 'maintenance-1', title: 'Kitchen Plumbing Issue' }] }, 'Assign it to Ade.', 'maintenance'],
  ['services', { last_intent: 'service_operation', last_user_message: 'Show service status', entities: [{ type: 'service', id: 'service-1', title: 'Water Service' }] }, 'Show me more.', 'service'],
  ['wallet', { last_intent: 'wallet_operation', entities: [{ type: 'wallet', id: 'wallet-1', title: 'Home Wallet' }] }, 'When?', 'wallet'],
  ['community', { last_intent: 'community_operation', entities: [{ type: 'community', id: 'post-1', title: 'Estate Notice' }] }, 'Who?', 'community'],
  ['reports', { last_intent: 'report_generation', entities: [{ type: 'report', id: 'report-1', title: 'Daily Estate Report' }] }, 'Why?', 'report'],
  ['awareness', { last_intent: 'awareness', entities: [{ type: 'awareness', title: 'Maintenance requires attention' }] }, 'What should I do next?', 'awareness'],
];

let failed = 0;
for (const [message, assertion] of cases) {
  const value = resolveConversationFollowUpForTest(message, state);
  if (!assertion(value)) {
    failed += 1;
    console.error(`FAIL conversation: ${message}`, value);
  } else {
    console.log(`PASS conversation: ${message}`);
  }
}

for (const [subsystem, subsystemState, message, expectedType] of subsystemCases) {
  const value = resolveConversationFollowUpForTest(message, subsystemState);
  if (!value.is_follow_up || value.entity?.type !== expectedType) {
    failed += 1;
    console.error(`FAIL subsystem conversation: ${subsystem}`, value);
  } else {
    console.log(`PASS subsystem conversation: ${subsystem}`);
  }
}

if (failed) process.exit(1);
