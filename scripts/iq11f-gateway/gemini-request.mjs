// Shared serialization only: no network, credentials, authorization or execution.
import {checkPacket, hash} from '../iq11e/contract.mjs';
import {defaultRegistry} from './registry.mjs';

export const GEMINI_SHADOW = Object.freeze({
  project: 'gen-lang-client-0414833380', model: 'gemini-3.1-flash-lite',
  responseVersion: '3.1-flash-lite-05-2026',
  inputTokens: 4096, outputTokens: 1024, deadlineMs: 3000,
  responseBytes: 65536, authorizedUsd: 0, retries: 0, fallback: false,
});
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export function prepareGeminiShadow(packet) {
  if (checkPacket(packet).length) throw Error('invalid_packet');
  if (/AIza[\w-]{20,}/.test(JSON.stringify(packet))) throw Error('sensitive_material');
  const body = defaultRegistry().get('gemini').describe(packet, GEMINI_SHADOW.model, {output: GEMINI_SHADOW.outputTokens}).body;
  body.generationConfig.thinkingConfig = {thinkingLevel: 'minimal', includeThoughts: false};
  return freeze({body, body_hash: hash(body), packet_hash: hash(packet),
    schema_hash: hash(body.generationConfig.responseJsonSchema), model: GEMINI_SHADOW.model});
}
