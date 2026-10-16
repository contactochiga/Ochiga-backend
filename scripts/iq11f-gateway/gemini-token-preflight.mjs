// Pure preparation: no network, credential access, tokenizer guess or live approval.
import {hash} from '../iq11e/contract.mjs';
import {GEMINI_SHADOW, prepareGeminiShadow} from './gemini-shadow.mjs';

export function prepareGeminiTokenPreflight(packet) {
  const prepared = prepareGeminiShadow(packet);
  const body = prepared.body;
  const bytes = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value));
  // The canonical countTokens endpoint accepts GenerateContentRequest, including
  // model, systemInstruction and generationConfig. Contents-only is insufficient.
  const countRequest = {generateContentRequest: {model: `models/${prepared.model}`, ...structuredClone(body)}};
  const componentBytes = Object.fromEntries(Object.entries(body).map(([key, value]) => [key, bytes(value)]));
  const bodyBytes = bytes(body);
  return {
    count_request: countRequest,
    evidence: {
      provider: 'gemini', model: prepared.model, body_hash: prepared.body_hash,
      packet_hash: prepared.packet_hash, schema_hash: prepared.schema_hash,
      count_request_hash: hash(countRequest), body_bytes: bodyBytes,
      component_json_bytes: componentBytes,
      body_json_framing_bytes: bodyBytes - Object.values(componentBytes).reduce((a, b) => a + b, 0),
      instruction_text_bytes: bytes(body.systemInstruction.parts[0].text),
      user_payload_text_bytes: bytes(body.contents[0].parts[0].text),
      schema_json_bytes: bytes(body.generationConfig.responseJsonSchema),
      count_request_bytes: bytes(countRequest),
      input_token_cap: GEMINI_SHADOW.inputTokens,
      output_cap_including_thinking: GEMINI_SHADOW.outputTokens,
      measured_input_tokens: null, provider_internal_framing_tokens: null,
      full_input_upper_bound: null, full_request_verified: false,
      can_dispatch_inference: false,
      status: 'UNVERIFIED_TOKEN_ACCOUNTING',
      missing_evidence: [
        'Authorized zero-cost model-specific token measurement of this exact full count request',
        'Authoritative coverage of instructions, responseJsonSchema and internal model framing',
        'Verified full-input upper bound <=4096 bound to unchanged wire request and model',
      ],
    },
  };
}
