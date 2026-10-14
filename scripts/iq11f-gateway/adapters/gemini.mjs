import {instruction, payload, schemaFor, count, sum, outcome, candidateText, boundedBody, mockDescription} from './common.mjs';
export const gemini = Object.freeze({
  id: 'gemini', version: 1, mode: 'offline_mock_only', protocol: 'generateContent-compatibility-profile',
  describe(packet, model, limits) {
    // Legacy compatibility profile, not an assertion of support by an unselected model.
    // API version/schema migration must be frozen and approved before any live canary.
    return mockDescription(this.id, model, {systemInstruction: {parts: [{text: instruction}]}, contents: [{role: 'user', parts: [{text: payload(packet)}]}], generationConfig: {candidateCount: 1, maxOutputTokens: limits.output, responseMimeType: 'application/json', responseJsonSchema: schemaFor(this.id)}});
  },
  normalize(body, model) {
    if (!boundedBody(body) || body.modelVersion !== model) return outcome('invalid_response');
    const u = body.usageMetadata;
    const usage = u ? {input_total: count(u.promptTokenCount), output_total: sum(u.candidatesTokenCount, u.thoughtsTokenCount), cached_input: count(u.cachedContentTokenCount), cache_write: null, reasoning_output: count(u.thoughtsTokenCount), semantics: 'output_adds_candidate_and_thought_tokens'} : null;
    if (body.promptFeedback?.blockReason) return outcome('refused', usage);
    if (!Array.isArray(body.candidates) || body.candidates.length !== 1) return outcome('unexpected_output', usage);
    const c = body.candidates[0];
    if (['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'RECITATION', 'SPII'].includes(c.finishReason)) return outcome('refused', usage);
    if (c.finishReason === 'MAX_TOKENS') return outcome('incomplete', usage);
    if (c.finishReason !== 'STOP') return outcome('unexpected_output', usage);
    const parts = c.content?.parts;
    if (!Array.isArray(parts) || parts.length !== 1 || typeof parts[0].text !== 'string' || Object.keys(parts[0]).some(k => k !== 'text')) return outcome('unexpected_output', usage);
    return candidateText(parts[0].text, usage);
  }
});
