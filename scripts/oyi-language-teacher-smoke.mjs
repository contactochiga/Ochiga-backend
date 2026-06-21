#!/usr/bin/env node
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'local-smoke-service-role-key';

const { localNormalizePhrase } = await import('../dist/language-teacher/languageNormalization.js');
const { canPromotePhrase, resultToCandidate, assertLanguageTeacherSafety } = await import('../dist/language-teacher/languageLearningEngine.js');
const { shouldAskLanguageTeacher, languageTeacherResultToMessage } = await import('../dist/language-teacher/languageTeacherService.js');
const { createProviderRegistry, OpenAIAdapter, GeminiAdapter, AnthropicAdapter } = await import('../dist/language-teacher/providerRegistry.js');

let failed = 0;
const cases = [
  ['gate pass list', 'visitors', 'visitor_operation'],
  ['broken pipe request', 'maintenance', 'maintenance_operation'],
  ['how much do i owe', 'wallet', 'wallet_operation'],
  ['fiber account problem', 'services', 'service_operation'],
  ['operator request queue', 'operational_queue', 'investigation'],
];

for (const [phrase, domain, intent] of cases) {
  const result = localNormalizePhrase(phrase);
  if (!result || result.domain !== domain || result.intent !== intent || result.provider !== 'local') {
    failed += 1;
    console.error('FAIL normalize', phrase, result);
  } else {
    console.log(`PASS normalize: ${phrase} -> ${result.normalized_phrase}`);
  }
}

const promotionCandidate = { phrase: 'gate pass list', normalized_phrase: 'show visitor access', domain: 'visitors', intent: 'visitor_operation', confidence: 0.9, usage_count: 3, success_count: 3, status: 'candidate' };
if (!canPromotePhrase(promotionCandidate)) {
  failed += 1;
  console.error('FAIL promotion policy', promotionCandidate);
} else {
  console.log('PASS promotion policy');
}

const lowCandidate = { ...promotionCandidate, confidence: 0.4 };
if (canPromotePhrase(lowCandidate)) {
  failed += 1;
  console.error('FAIL low confidence promotion guard');
} else {
  console.log('PASS low confidence promotion guard');
}

const result = localNormalizePhrase('gate pass list');
const providers = createProviderRegistry({ name: 'local', interpret: async () => result });
const providerNames = ['local', 'openai', 'gemini', 'anthropic', 'groq'];
const providerContractOk = providerNames.every((name) => typeof providers.get(name)?.interpret === 'function')
  && typeof new OpenAIAdapter().interpret === 'function'
  && typeof new GeminiAdapter().interpret === 'function'
  && typeof new AnthropicAdapter().interpret === 'function';
if (!providerContractOk) {
  failed += 1;
  console.error('FAIL provider contract');
} else {
  console.log('PASS provider contract');
}
const safety = assertLanguageTeacherSafety(result);
if (!safety.ok || safety.may_execute || safety.may_bypass_permissions || safety.may_bypass_confirmation) {
  failed += 1;
  console.error('FAIL safety boundary', safety);
} else {
  console.log('PASS safety boundary');
}

const candidate = resultToCandidate('gate pass list', result);
if (candidate.status !== 'candidate' || candidate.usage_count !== 1 || candidate.normalized_phrase !== 'show visitor access') {
  failed += 1;
  console.error('FAIL candidate shape', candidate);
} else {
  console.log('PASS candidate shape');
}

if (!shouldAskLanguageTeacher({ domain: null, intent: 'general_help', phrase: 'gate pass list' }) || shouldAskLanguageTeacher({ domain: 'visitors', intent: 'visitor_operation', phrase: 'visitor access' })) {
  failed += 1;
  console.error('FAIL low confidence gate');
} else {
  console.log('PASS low confidence gate');
}

if (languageTeacherResultToMessage(result, 'fallback') !== 'show visitor access') {
  failed += 1;
  console.error('FAIL result message mapping');
} else {
  console.log('PASS result message mapping');
}

if (failed) process.exit(1);
