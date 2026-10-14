import {instruction, payload, schemaFor, count, outcome, candidateText, boundedBody, mockDescription} from './common.mjs';
export const openai = Object.freeze({
  id: 'openai', version: 1, mode: 'offline_mock_only', protocol: 'responses',
  describe(packet, model, limits) {
    return mockDescription(this.id, model, {model, instructions: instruction, input: payload(packet), tools: [], store: false, background: false, stream: false, reasoning: {effort: 'none'}, max_output_tokens: limits.output, text: {format: {type: 'json_schema', name: 'oyi_candidate', strict: true, schema: schemaFor(this.id)}}});
  },
  normalize(body, model) {
    if (!boundedBody(body) || body.model !== model) return outcome('invalid_response');
    const u = body.usage;
    const usage = u ? {input_total: count(u.input_tokens), output_total: count(u.output_tokens), cached_input: count(u.input_tokens_details?.cached_tokens), cache_write: null, reasoning_output: count(u.output_tokens_details?.reasoning_tokens), semantics: 'output_includes_reasoning'} : null;
    if (body.status === 'incomplete') return outcome('incomplete', usage);
    if (body.status !== 'completed' || !Array.isArray(body.output)) return outcome('invalid_response', usage);
    if (body.output.some(x => x.type !== 'message')) return outcome('unexpected_output', usage);
    const content = body.output.flatMap(x => Array.isArray(x.content) ? x.content : [{type: 'invalid'}]);
    if (content.some(x => x.type === 'refusal')) return outcome('refused', usage);
    if (content.length !== 1 || content[0].type !== 'output_text') return outcome('unexpected_output', usage);
    return candidateText(content[0].text, usage);
  }
});
