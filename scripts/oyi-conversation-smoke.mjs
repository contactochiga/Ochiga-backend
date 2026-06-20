#!/usr/bin/env node
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'local-smoke-service-role-key';

const { resolveConversationFollowUpForTest, displayModeForTest, responsePresentationForTest, normalizeOyiMessageForTest } = await import('../dist/services/oyiUnifiedIntelligenceService.js');

const state = {
  last_intent: 'visitor_operation',
  last_user_message: 'Show pending visitors',
  entities: [
    { type: 'visitor', id: 'visitor-1', title: 'Ada Okafor', status: 'pending' },
    { type: 'visitor', id: 'visitor-2', title: 'Tunde Bello', status: 'pending' },
  ],
  active_entity_id: 'visitor-1',
  active_entity_label: 'Ada Okafor',
  pending_confirmation_id: 'ledger-1',
};

const cases = [
  ['Approve the first one.', (value) => value.is_follow_up && value.entity?.id === 'visitor-1'],
  ['The first one', (value) => value.is_follow_up && value.entity?.id === 'visitor-1'],
  ['number 2', (value) => value.is_follow_up && value.entity?.id === 'visitor-2'],
  ['2nd', (value) => value.is_follow_up && value.entity?.id === 'visitor-2'],
  ['Tunde', (value) => value.is_follow_up && value.entity?.id === 'visitor-2'],
  ['Why?', (value) => value.intent === 'investigation' && /Ada Okafor/.test(value.expanded_message)],
  ['When?', (value) => value.intent === 'investigation' && /last updated/.test(value.expanded_message)],
  ['Who?', (value) => value.intent === 'investigation' && /associated/.test(value.expanded_message)],
  ['When was he added?', (value) => value.is_follow_up && value.entity?.id === 'visitor-1'],
  ['Remove him', (value) => value.is_follow_up && value.entity?.id === 'visitor-1'],
  ['Show details', (value) => value.is_follow_up && value.entity?.id === 'visitor-1'],
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

const ordinalState = {
  last_intent: 'visitor_operation',
  active_topic: 'visitor',
  active_result_state: 'list',
  entities: [
    { type: 'visitor', id: 'visitor-1', title: 'Salish Males', status: 'pending' },
    { type: 'visitor', id: 'visitor-2', title: 'Ezekel Salisu', status: 'pending' },
    { type: 'visitor', id: 'visitor-3', title: 'John Delivery', status: 'pending' },
  ],
};

const ordinalCases = [
  ['first', 'visitor-1'], ['first one', 'visitor-1'], ['the first one', 'visitor-1'], ['1', 'visitor-1'], ['1st', 'visitor-1'], ['number 1', 'visitor-1'], ['number one', 'visitor-1'], ['one', 'visitor-1'],
  ['second', 'visitor-2'], ['second one', 'visitor-2'], ['the second one', 'visitor-2'], ['2', 'visitor-2'], ['2nd', 'visitor-2'], ['number 2', 'visitor-2'], ['number two', 'visitor-2'], ['two', 'visitor-2'],
  ['third', 'visitor-3'], ['third one', 'visitor-3'], ['the third one', 'visitor-3'], ['3', 'visitor-3'], ['3rd', 'visitor-3'], ['number 3', 'visitor-3'], ['number three', 'visitor-3'],
  ['Show John Delivery', 'visitor-3'], ['Ezekel', 'visitor-2'],
];

const resolverCases = [
  ['consumer empty visitors', { last_intent: 'visitor_operation', active_topic: 'visitor', active_result_state: 'empty', entities: [] }, 'Why?', 'empty_explanation'],
  ['consumer empty visitor ordinal', { last_intent: 'visitor_operation', active_topic: 'visitor', active_result_state: 'empty', entities: [] }, 'Show me the first one', 'empty_ordinal'],
  ['consumer empty maintenance', { last_intent: 'maintenance_operation', active_topic: 'maintenance', active_result_state: 'empty', entities: [] }, 'Show me the first one', 'empty_ordinal'],
  ['consumer empty maintenance typo', { last_intent: 'maintenance_operation', active_topic: 'maintenance', active_result_state: 'empty', entities: [] }, 'The first one', 'empty_ordinal'],
  ['facility empty community', { last_intent: 'community_operation', active_topic: 'community', active_result_state: 'empty', entities: [] }, 'The first one', 'empty_ordinal'],
  ['workflow empty', { last_intent: 'investigation', active_topic: 'workflow', active_result_state: 'empty', entities: [] }, 'Open the first one', 'empty_ordinal'],
  ['maintenance clarification', { last_intent: 'maintenance_operation', active_topic: 'maintenance', active_result_state: 'list', entities: [] }, 'Who reported it?', 'topic_clarification'],
  ['facility visitor empty', { last_intent: 'visitor_operation', active_topic: 'visitor', active_result_state: 'empty', entities: [] }, 'Why?', 'empty_explanation'],
  ['facility maintenance detail', { last_intent: 'maintenance_operation', active_topic: 'maintenance', active_result_state: 'list', entities: [{ type: 'maintenance', id: 'maintenance-1', title: 'Gate light repair', status: 'open' }] }, 'Show me the first one', 'entity'],
  ['facility queue detail', { last_intent: 'investigation', active_topic: 'queue', active_result_state: 'list', entities: [{ type: 'maintenance', id: 'maintenance-1', title: 'Gate light repair', status: 'open' }] }, 'Open the 1st one', 'entity'],
  ['workflow owner detail', { last_intent: 'investigation', active_topic: 'workflow', active_result_state: 'list', entities: [{ type: 'workflow', id: 'workflow-1', title: 'Assign gate repair', status: 'assigned', details: { owner: 'Ade' } }] }, 'Who owns it?', 'entity'],
  ['visitor assign guard', { last_intent: 'visitor_operation', active_topic: 'visitor', active_result_state: 'list', active_entity_id: 'visitor-1', active_entity_label: 'Salish Males', entities: [{ type: 'visitor', id: 'visitor-1', title: 'Salish Males', status: 'pending' }] }, 'Assign it to Ade', 'entity'],
  ['facility awareness remains awareness', { last_intent: 'awareness', active_topic: 'awareness', active_result_state: 'list', entities: [{ type: 'awareness', title: 'Maintenance requires attention' }] }, 'What should I do next?', 'none'],
];

const displayCases = [
  ['conversation', 'visitor_operation', false, 'conversation'],
  ['Show visitor requests', 'visitor_operation', true, 'conversation'],
  ['Show me the first one', 'visitor_operation', false, 'conversation'],
  ['Generate report', 'report_generation', true, 'report'],
  ['What’s happening?', 'awareness', true, 'awareness'],
];

const directDomainPresentationCases = [
  ['Show wallet', 'wallet_operation'],
  ['Show devices', 'device_status'],
  ['Show visitor access', 'visitor_operation'],
  ['Any visitor pending?', 'visitor_operation'],
  ['Show community updates', 'community_operation'],
  ['Show maintenance requests', 'maintenance_operation'],
];

const normalizationCases = [
  ['Who is visiting?', 'show visitor access'],
  ['Who is at my house?', 'show visitor access'],
  ['Turn lights on', 'turn on lights'],
  ['Power off lights', 'turn off lights'],
  ['Show maintainance requests', 'Show maintenance requests'],
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
  const first = subsystemState.entities?.[0];
  const value = resolveConversationFollowUpForTest(message, {
    ...subsystemState,
    active_entity_id: first?.id,
    active_entity_label: first?.title,
  });
  const passed = subsystem === 'services'
    ? value.is_follow_up && value.intent === 'service_operation'
    : subsystem === 'awareness'
    ? value.is_follow_up && value.intent === 'awareness'
    : value.is_follow_up && value.entity?.type === expectedType;
  if (!passed) {
    failed += 1;
    console.error(`FAIL subsystem conversation: ${subsystem}`, value);
  } else {
    console.log(`PASS subsystem conversation: ${subsystem}`);
  }
}

for (const [message, expectedId] of ordinalCases) {
  const value = resolveConversationFollowUpForTest(message, ordinalState);
  if (!value.is_follow_up || value.entity?.id !== expectedId) {
    failed += 1;
    console.error(`FAIL active entity reference: ${message}`, value);
  } else {
    console.log(`PASS active entity reference: ${message}`);
  }
}

for (const [name, resolverState, message, expectedResolution] of resolverCases) {
  const value = resolveConversationFollowUpForTest(message, resolverState);
  if (value.resolution !== expectedResolution) {
    failed += 1;
    console.error(`FAIL resolver: ${name}`, value);
  } else {
    console.log(`PASS resolver: ${name}`);
  }
}

for (const [message, intent, hasCards, expected] of displayCases) {
  const actual = displayModeForTest(message, intent, hasCards);
  if (actual !== expected) {
    failed += 1;
    console.error(`FAIL display mode: ${message} expected ${expected}, got ${actual}`);
  } else {
    console.log(`PASS display mode: ${message} -> ${actual}`);
  }
}

for (const [message, intent] of directDomainPresentationCases) {
  const presentation = responsePresentationForTest(message, intent, true);
  if (presentation.display_mode !== 'conversation' || presentation.support_payload_attached) {
    failed += 1;
    console.error(`FAIL direct domain presentation: ${message}`, presentation);
  } else {
    console.log(`PASS direct domain presentation: ${message}`);
  }
}

for (const [message, expected] of normalizationCases) {
  const actual = normalizeOyiMessageForTest(message);
  if (actual !== expected) {
    failed += 1;
    console.error(`FAIL normalization: ${message} expected ${expected}, got ${actual}`);
  } else {
    console.log(`PASS normalization: ${message}`);
  }
}

if (failed) process.exit(1);
