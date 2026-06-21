#!/usr/bin/env node
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'local-smoke-service-role-key';

const { resolveConversationFollowUpForTest, displayModeForTest, responsePresentationForTest, normalizeOyiMessageForTest, resolveOyiDomainIntentForTest, deviceConversationResultForTest, deviceTimelineNarrativeForTest } = await import('../dist/services/oyiUnifiedIntelligenceService.js');
const { resolveDeviceRuntimeScope, buildDeviceTimeline } = await import('../dist/services/deviceRuntimeService.js');

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
  ['What is the status?', (value) => value.is_follow_up && value.entity?.id === 'visitor-1'],
  ['Show evidence', (value) => value.is_follow_up && value.entity?.id === 'visitor-1'],
  ['When was he added?', (value) => value.is_follow_up && value.entity?.id === 'visitor-1'],
  ['Remove him', (value) => value.is_follow_up && value.entity?.id === 'visitor-1'],
  ['Show details', (value) => value.is_follow_up && value.entity?.id === 'visitor-1'],
  ['Show me more.', (value) => value.expanded_message === 'Show pending visitors'],
  ['Do it.', (value) => value.pending_confirmation_id === 'ledger-1'],
  ['Yes', (value) => value.is_follow_up && value.pending_confirmation_id === 'ledger-1'],
  ['No', (value) => value.is_follow_up && value.pending_confirmation_id === 'ledger-1'],
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
  ['latest', 'visitor-3'], ['most recent', 'visitor-3'], ['Show John Delivery', 'visitor-3'], ['Ezekel', 'visitor-2'],
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
  ['workflow most recent detail', { last_intent: 'investigation', active_topic: 'workflow', active_result_state: 'list', entities: [{ type: 'workflow', id: 'workflow-1', title: 'Assign gate repair', status: 'assigned' }, { type: 'workflow', id: 'workflow-2', title: 'Verify pump repair', status: 'created' }] }, 'Open the most recent one', 'entity'],
  ['workflow history detail', { last_intent: 'investigation', active_topic: 'workflow', active_result_state: 'list', active_entity_id: 'workflow-1', active_entity_label: 'Assign gate repair', entities: [{ type: 'workflow', id: 'workflow-1', title: 'Assign gate repair', status: 'assigned', details: { owner: 'Ade', summary: 'Gate repair is assigned.' } }] }, 'Show history', 'entity'],
  ['workflow status detail', { last_intent: 'investigation', active_topic: 'workflow', active_result_state: 'list', active_entity_id: 'workflow-1', active_entity_label: 'Assign gate repair', entities: [{ type: 'workflow', id: 'workflow-1', title: 'Assign gate repair', status: 'assigned', details: { owner: 'Ade', summary: 'Gate repair is assigned.' } }] }, 'What is the status?', 'entity'],
  ['workflow evidence detail', { last_intent: 'investigation', active_topic: 'workflow', active_result_state: 'list', active_entity_id: 'workflow-1', active_entity_label: 'Assign gate repair', entities: [{ type: 'workflow', id: 'workflow-1', title: 'Assign gate repair', status: 'assigned', details: { owner: 'Ade', summary: 'Gate repair is assigned.' } }] }, 'Show evidence', 'entity'],
  ['workflow assigned time', { last_intent: 'investigation', active_topic: 'workflow', active_result_state: 'list', active_entity_id: 'workflow-1', active_entity_label: 'Assign gate repair', entities: [{ type: 'workflow', id: 'workflow-1', title: 'Assign gate repair', status: 'assigned', details: { owner: 'Ade', assigned_at: '2026-06-20T08:00:00.000Z' } }] }, 'When was it assigned?', 'entity'],
  ['workflow overdue investigation', { last_intent: 'investigation', active_topic: 'workflow', active_result_state: 'list', active_entity_id: 'workflow-1', active_entity_label: 'Assign gate repair', entities: [{ type: 'workflow', id: 'workflow-1', title: 'Assign gate repair', status: 'assigned', details: { owner: 'Ade', due_at: '2026-06-20T08:00:00.000Z' } }] }, 'How overdue is it?', 'entity'],
  ['workflow verification state', { last_intent: 'investigation', active_topic: 'workflow', active_result_state: 'list', active_entity_id: 'workflow-1', active_entity_label: 'Assign gate repair', entities: [{ type: 'workflow', id: 'workflow-1', title: 'Assign gate repair', status: 'completed', details: { owner: 'Ade', verification_state: 'pending' } }] }, 'Verify it?', 'entity'],
  ['attention selected next action', { last_intent: 'awareness', active_topic: 'queue', active_result_state: 'entity', active_entity_id: 'workflow-1', active_entity_label: 'Critical pump workflow', entities: [{ type: 'workflow', id: 'workflow-1', title: 'Critical pump workflow', status: 'assigned', details: { owner: 'Facility', due_at: '2026-06-20T08:00:00.000Z', blocker_reason: 'Pump verification is pending.' } }] }, 'What should I do next?', 'entity'],
  ['attention selected why', { last_intent: 'awareness', active_topic: 'queue', active_result_state: 'entity', active_entity_id: 'workflow-1', active_entity_label: 'Critical pump workflow', entities: [{ type: 'workflow', id: 'workflow-1', title: 'Critical pump workflow', status: 'assigned', details: { owner: 'Facility', blocker_reason: 'Pump verification is pending.' } }] }, 'Why?', 'entity'],
  ['visitor assign guard', { last_intent: 'visitor_operation', active_topic: 'visitor', active_result_state: 'list', active_entity_id: 'visitor-1', active_entity_label: 'Salish Males', entities: [{ type: 'visitor', id: 'visitor-1', title: 'Salish Males', status: 'pending' }] }, 'Assign it to Ade', 'entity'],
  ['facility attention item next action', { last_intent: 'awareness', active_topic: 'awareness', active_result_state: 'list', entities: [{ type: 'awareness', title: 'Maintenance requires attention' }] }, 'What should I do next?', 'entity'],
  ['empty wallet ordinal', { last_intent: 'wallet_operation', active_topic: 'wallet', active_result_state: 'empty', entities: [] }, 'The first one', 'empty_ordinal'],
  ['empty wallet status', { last_intent: 'wallet_operation', active_topic: 'wallet', active_result_state: 'empty', entities: [] }, 'What is the status?', 'empty_topic'],
  ['empty device next action', { last_intent: 'device_status', active_topic: 'device', active_result_state: 'empty', entities: [] }, 'What should I do next?', 'empty_topic'],
  ['empty community why', { last_intent: 'community_operation', active_topic: 'community', active_result_state: 'empty', entities: [] }, 'Why?', 'empty_explanation'],
  ['empty reports verify', { last_intent: 'report_generation', active_topic: 'report', active_result_state: 'empty', entities: [] }, 'Verify it', 'empty_topic'],
  ['empty services ordinal', { last_intent: 'service_operation', active_topic: 'service', active_result_state: 'empty', entities: [] }, 'The first one', 'empty_ordinal'],
  ['empty notification details', { last_intent: 'notification_operation', active_topic: 'notification', active_result_state: 'empty', entities: [] }, 'Show details', 'empty_topic'],
  ['empty notifications ordinal', { last_intent: 'notification_operation', active_topic: 'notification', active_result_state: 'empty', entities: [] }, 'The first one', 'empty_ordinal'],
  ['empty staff ordinal', { last_intent: 'general_help', active_topic: 'staff', active_result_state: 'empty', entities: [] }, 'The first one', 'empty_ordinal'],
  ['empty camera ordinal', { last_intent: 'device_status', active_topic: 'camera', active_result_state: 'empty', entities: [] }, 'The first one', 'empty_ordinal'],
  ['empty reports ordinal', { last_intent: 'report_generation', active_topic: 'report', active_result_state: 'empty', entities: [] }, 'The latest report', 'empty_ordinal'],
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
  ['Show services', 'service_operation'],
  ['Show wallet', 'wallet_operation'],
  ['Show notifications', 'notification_operation'],
  ['Show utility issues', 'service_operation'],
  ['Show security incidents', 'investigation'],
  ['Show reports', 'report_generation'],
];

const normalizationCases = [
  ['Who is visiting?', 'show visitor access'],
  ['Who is at my house?', 'show visitor access'],
  ['Who came in?', 'show visitor access'],
  ['Show vistors', 'Show visitors'],
  ['visitor acess', 'visitor access'],
  ['gate pass', 'show visitor access'],
  ['Turn lights on', 'turn on lights'],
  ['Power off lights', 'turn off lights'],
  ['power it down', 'turn off lights'],
  ['Show maintainance requests', 'Show maintenance requests'],
  ['Show maintenace requests', 'Show maintenance requests'],
  ['mainterequest', 'maintenance request'],
  ['fault report', 'maintenance request'],
];

const domainCases = [
  ['consumer', 'open visitor access', 'visitors'],
  ['consumer', 'any visitors pending', 'visitors'],
  ['consumer', 'show maintenance request', 'maintenance'],
  ['consumer', 'show maintainance request', 'maintenance'],
  ['consumer', 'show devices', 'devices'],
  ['consumer', 'show wallet', 'wallet'],
  ['consumer', 'show dues', 'wallet'],
  ['consumer', 'show community reports', 'community'],
  ['consumer', 'show service requests', 'services'],
  ['consumer', 'show utility issues', 'utilities'],
  ['consumer', 'show rooms', 'rooms'],
  ['consumer', 'show scenes', 'scenes'],
  ['consumer', 'show automation', 'automation'],
  ['consumer', 'show home profile', 'profile'],
  ['consumer', 'show notifications', 'notifications'],
  ['consumer', 'show activity timeline', 'activity'],
  ['facility', 'open most recent requests', 'operational_queue'],
  ['facility', 'open operator requests', 'operational_queue'],
  ['facility', 'show staff tasks', 'staff'],
  ['facility', 'show security incidents', 'security'],
  ['facility', 'show camera events', 'cameras'],
  ['facility', 'show utility issues', 'utilities'],
  ['facility', 'show active workflows', 'workflows'],
  ['facility', 'show estate structure', 'estate'],
  ['facility', 'show traffic records', 'traffic'],
  ['facility', 'show sensors', 'sensors'],
  ['facility', 'show accounting', 'wallet'],
  ['facility', 'show daily estate report', 'reports'],
];

const deviceRows = [
  { type: 'device', id: 'device-1', title: 'Living Room Light', status: 'online • on', details: { online_state: 'online' } },
  { type: 'device', id: 'device-2', title: 'Water Pump', status: 'offline', details: { online_state: 'offline' } },
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

for (const [surface, message, expectedDomain] of domainCases) {
  const actual = resolveOyiDomainIntentForTest(message, surface);
  if (actual.domain !== expectedDomain || actual.awareness_fallback_used) {
    failed += 1;
    console.error(`FAIL domain coverage: ${surface} ${message}`, actual);
  } else {
    console.log(`PASS domain coverage: ${surface} ${message} -> ${actual.domain}`);
  }
}

const consumerDevices = deviceConversationResultForTest({ surface: 'consumer', message: 'Show devices', entities: deviceRows });
if (!/2 devices available/i.test(consumerDevices.message) || consumerDevices.entities.length !== 2) {
  failed += 1;
  console.error('FAIL consumer device list result', consumerDevices);
} else {
  console.log('PASS consumer device list result');
}

const facilityOffline = deviceConversationResultForTest({ surface: 'facility', message: 'Show offline devices', entities: deviceRows });
if (!/1 device available/i.test(facilityOffline.message) || facilityOffline.entities[0]?.id !== 'device-2') {
  failed += 1;
  console.error('FAIL facility offline device result', facilityOffline);
} else {
  console.log('PASS facility offline device result');
}

const facilityEmpty = deviceConversationResultForTest({ surface: 'facility', message: 'Show infrastructure devices', entities: [] });
if (!/infrastructure devices for this facility context/i.test(facilityEmpty.message) || /home context/i.test(facilityEmpty.message)) {
  failed += 1;
  console.error('FAIL facility device empty wording', facilityEmpty);
} else {
  console.log('PASS facility device empty wording');
}

const consumerScope = resolveDeviceRuntimeScope({ estate_id: 'estate-1', home_id: 'home-1' });
const facilityScope = resolveDeviceRuntimeScope({ estate_id: 'estate-1', home_id: 'home-1' }, { estateWide: true });
if (consumerScope.homeId !== 'home-1' || facilityScope.homeId !== null || !facilityScope.estateWide) {
  failed += 1;
  console.error('FAIL device scope isolation', { consumerScope, facilityScope });
} else {
  console.log('PASS device scope isolation');
}

const deviceTimeline = buildDeviceTimeline(
  { online: false, last_seen_at: '2026-02-01T10:41:00.000Z', last_event_at: '2026-06-10T08:00:00.000Z' },
  { updated_at: '2026-06-12T17:05:00.000Z', last_seen: '2026-06-12T17:05:00.000Z', status: { _oyi_timeline: { provider_reported_at: '2026-06-12T17:04:00.000Z' } } },
);
const timelineNarrative = deviceTimelineNarrativeForTest(deviceTimeline);
if (deviceTimeline.latest_state_at !== '2026-06-12T17:05:00.000Z'
  || deviceTimeline.last_seen_at !== '2026-02-01T10:41:00.000Z'
  || deviceTimeline.provider_reported_at !== '2026-06-12T17:04:00.000Z'
  || !/Latest state update was received/.test(timelineNarrative)
  || !/last confirmed online/.test(timelineNarrative)
  || !/provider reported this event/i.test(timelineNarrative)) {
  failed += 1;
  console.error('FAIL device timeline contract', { deviceTimeline, timelineNarrative });
} else {
  console.log('PASS device timeline contract');
}

if (failed) process.exit(1);
