import {instruction, payload, schemaFor, count, sum, outcome, candidateText, boundedBody, mockDescription} from './common.mjs';
export const anthropic = Object.freeze({
  id: 'anthropic', version: 1, mode: 'offline_mock_only', protocol: 'messages',
  describe(packet, model, limits) {
    return mockDescription(this.id, model, {model, system: instruction, messages: [{role: 'user', content: payload(packet)}], max_tokens: limits.output, stream: false, output_config: {format: {type: 'json_schema', schema: schemaFor(this.id)}}});
  },
  normalize(body, model) {
    if (!boundedBody(body) || body.model !== model || body.type !== 'message') return outcome('invalid_response');
    const u = body.usage;
    const usage = u ? {input_total: sum(u.input_tokens, u.cache_read_input_tokens, u.cache_creation_input_tokens), output_total: count(u.output_tokens), cached_input: count(u.cache_read_input_tokens), cache_write: count(u.cache_creation_input_tokens), reasoning_output: null, semantics: 'input_includes_cache_read_and_creation;output_includes_thinking'} : null;
    if (body.stop_reason === 'refusal') return outcome('refused', usage);
    if (body.stop_reason === 'max_tokens' || body.stop_reason === 'model_context_window_exceeded') return outcome('incomplete', usage);
    if (body.stop_reason !== 'end_turn') return outcome('unexpected_output', usage);
    if (!Array.isArray(body.content) || body.content.length !== 1 || body.content[0].type !== 'text') return outcome('unexpected_output', usage);
    return candidateText(body.content[0].text, usage);
  }
});
