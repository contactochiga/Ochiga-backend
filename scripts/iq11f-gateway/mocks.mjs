// Maintainer-authored transport fixtures, not independently authored intelligence cases.
import {hash} from '../iq11e/contract.mjs';
import {candidate} from '../iq11e/fixtures.mjs';
export const mockModel = id => `mock-${id}-snapshot`;
export function mockProfile(id, p) {
  return {provider: id, model: mockModel(id), mode: 'offline_mock_only', policy_id: `mock-${id}-policy`, tokenizer_id: 'mock-token-count', data_class: 'synthetic', surfaces: [p.surface], scope_tokens: [p.scope_token], expires_at: '2030-01-01T00:00:00Z', price: {version: 'SYNTHETIC_NOT_VENDOR_PRICING', input_upper_micro_per_token: 2, output_upper_micro_per_token: 5}};
}
export function mockBody(id, c) {
  const text = JSON.stringify(c), model = mockModel(id);
  if (id === 'openai') return {model, status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text}]}], usage: {input_tokens: 100, output_tokens: 100, input_tokens_details: {cached_tokens: 0}, output_tokens_details: {reasoning_tokens: 0}}};
  if (id === 'anthropic') return {model, type: 'message', stop_reason: 'end_turn', content: [{type: 'text', text}], usage: {input_tokens: 100, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0}};
  if (id === 'gemini') return {modelVersion: model, candidates: [{finishReason: 'STOP', content: {parts: [{text}]}}], usageMetadata: {promptTokenCount: 100, candidatesTokenCount: 100, thoughtsTokenCount: 0, cachedContentTokenCount: 0}};
  throw Error('unknown_mock_provider');
}
export function mockReply(id, p, c = candidate(p)) {
  return {provider: id, model: mockModel(id), request_id: p.request_id, context_epoch: p.context_epoch, input_hash: hash(p), elapsed_ms: 25, transport_status: 'ok', body: mockBody(id, c)};
}
export const mockTransfer = (from, to, p) => ({mode: 'offline_mock_only', from: `${from}/${mockModel(from)}`, to: `${to}/${mockModel(to)}`, packet_hash: hash(p), surface: p.surface, scope_token: p.scope_token, policy_id: `mock-${to}-policy`});
