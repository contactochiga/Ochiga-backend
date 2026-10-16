// Experiment transport only. Never import from src; no CLI, ambient-key lookup or auto-run.
import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {ROOT, checkPacket, hash, validateCandidate} from '../iq11e/contract.mjs';
import {defaultRegistry} from './registry.mjs';

export const GEMINI_SHADOW = Object.freeze({
  project: 'gen-lang-client-0748205572', model: 'gemini-3.1-flash-lite',
  // Catalog metadata, NOT a separately verified endpoint or immutable snapshot.
  responseVersion: '3.1-flash-lite-05-2026',
  inputTokens: 4096, outputTokens: 1024, deadlineMs: 3000,
  responseBytes: 65536, authorizedUsd: 0, retries: 0, fallback: false,
});
const adapter = defaultRegistry().get('gemini');
const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_SHADOW.model}:generateContent`;
const receiptRoot = path.join(ROOT, 'artifacts/iq11f-gemini-shadow-receipts');
const digest = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const integer = x => Number.isSafeInteger(x) && x >= 0;
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const result = (status, extra = {}) => freeze({status, adopted: false, canonical_decision_changed: false, shadow_candidate: null, ...extra});

export function prepareGeminiShadow(packet) {
  if (checkPacket(packet).length) throw Error('invalid_packet');
  // Additional credential hygiene; synthetic labels alone are not proof of data origin.
  if (/AIza[\w-]{20,}/.test(JSON.stringify(packet))) throw Error('sensitive_material');
  const body = adapter.describe(packet, GEMINI_SHADOW.model, {output: GEMINI_SHADOW.outputTokens}).body;
  body.generationConfig.thinkingConfig = {thinkingLevel: 'minimal', includeThoughts: false};
  // No SDK continuation, tools, cache, file references, URL context, grounding or streaming.
  return freeze({body, body_hash: hash(body), packet_hash: hash(packet),
    schema_hash: hash(body.generationConfig.responseJsonSchema), model: GEMINI_SHADOW.model});
}

// Approval is a TRUSTED operator preflight result, never a model/user packet field.
// This module cannot establish Google ownership or billing from an API key alone.
// No real approval is supplied by this change; mock proofs are not live evidence.
export function geminiShadowBlockers(prepared, apiKey, approval, now = Date.now()) {
  const a = approval, reasons = [];
  if (typeof apiKey !== 'string' || !apiKey.trim()) reasons.push('credential_missing');
  if (!a || a.live_canary_approved !== true) return [...reasons, 'canary_not_approved'];
  if (a.provider !== 'gemini' || a.project !== GEMINI_SHADOW.project || a.model !== GEMINI_SHADOW.model || a.response_version !== GEMINI_SHADOW.responseVersion) reasons.push('recipient_or_model_mismatch');
  if (!digest(a.credential_sha256) || a.credential_sha256 !== hash(apiKey || '')) reasons.push('credential_binding_missing');
  if (a.ownership_verified !== true || !digest(a.ownership_evidence_hash)) reasons.push('ownership_unverified');
  if (a.tier !== 'FREE' || a.billing_enabled !== false || a.free_quota_verified !== true || !digest(a.billing_quota_evidence_hash) || a.input_usd_per_token !== 0 || a.output_usd_per_token !== 0 || a.authorized_usd !== 0) reasons.push('zero_cost_unverified');
  if (a.synthetic_reviewed !== true || a.data_processing_approved !== true || a.packet_hash !== prepared.packet_hash || a.body_hash !== prepared.body_hash || a.schema_hash !== prepared.schema_hash) reasons.push('packet_or_policy_not_approved');
  if (!Number.isFinite(a.verified_at_ms) || !Number.isFinite(a.expires_at_ms) || a.verified_at_ms > now || a.expires_at_ms <= now || a.expires_at_ms - a.verified_at_ms > 300000) reasons.push('preflight_expired');
  const t = a.input_accounting;
  // Require an independently established upper bound INCLUDING system + schema + framing.
  // chars/4, content-only counts and unknown schema overhead do not qualify.
  if (!t || t.body_hash !== prepared.body_hash || t.model !== GEMINI_SHADOW.model || t.full_request_verified !== true || !digest(t.evidence_hash) || !integer(t.upper_bound) || t.upper_bound < 1 || t.upper_bound > GEMINI_SHADOW.inputTokens) reasons.push('input_accounting_unverified');
  if (a.max_inference_requests !== 1 || a.output_tokens !== GEMINI_SHADOW.outputTokens || a.deadline_ms !== GEMINI_SHADOW.deadlineMs || a.allow_tools !== false || a.allow_fallback !== false) reasons.push('limits_not_approved');
  return reasons;
}

// Same append+fsync journal discipline as IQ-11C, local experiment receipts only.
// A fixed exclusive file in the approved run directory reserves the ONE canary slot.
// Never remove/recreate it to retry uncertain work; incomplete journals block replay.
function reserve(directory, entry) {
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  const file = path.join(directory, 'gemini-canary.jsonl');
  let fd;
  try { fd = fs.openSync(file, 'wx', 0o600); }
  catch (e) { if (e.code === 'EEXIST') throw Object.assign(Error('attempt_reserved'), {code: 'ATTEMPT_RESERVED'}); throw e; }
  try {
    const append = value => {
      const bytes = Buffer.from(JSON.stringify(value) + '\n');
      let offset = 0;
      while (offset < bytes.length) offset += fs.writeSync(fd, bytes, offset, bytes.length - offset);
      fs.fsyncSync(fd);
    };
    append(entry);
    const parent = fs.openSync(directory, 'r');
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
    return {append, close: () => fs.closeSync(fd), file};
  } catch (e) { fs.closeSync(fd); throw e; }
}

async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw Error('invalid_response');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > GEMINI_SHADOW.responseBytes) { void reader.cancel().catch(() => {}); throw Error('response_too_large'); }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { throw Error('invalid_response'); }
  finally { reader.releaseLock(); }
}

export async function runGeminiShadow({packet, baseline, locks = {}, approval = null, apiKey},
  {fetchImpl, receiptDirectory = receiptRoot} = {}) {
  const start = performance.now();
  let p, a, l, prepared, baselineHash;
  try {
    // Capture before asynchronous work so subsequent caller mutation cannot alter admission.
    p = structuredClone(packet); a = structuredClone(approval); l = structuredClone(locks);
    baselineHash = hash(baseline); prepared = prepareGeminiShadow(p);
  } catch { return result('invalid_input'); }
  const blockers = geminiShadowBlockers(prepared, apiKey, a);
  const wallNow = Date.now();
  if (Math.abs(Date.parse(p.now) - wallNow) > 300000 || p.entities.some(e => Date.parse(e.expires_at) <= wallNow || e.facts.some(f => Date.parse(f.expires_at) <= wallNow))) blockers.push('context_expired');
  if (JSON.stringify(prepared.body).includes(apiKey || '\u0000')) blockers.push('credential_in_packet');
  if (blockers.length) return result('blocked', {blockers, baseline_hash: baselineHash});
  // No ambient network dispatch in this preparation. Mock approval booleans/hashes
  // must never be sufficient to reach global fetch. An approved future runner owns
  // independently verified IAM/billing/token preflight AND explicit transport wiring.
  // Injected test functions are trusted code, not a sandbox against malicious JS.
  if (typeof fetchImpl !== 'function' || fetchImpl === globalThis.fetch) return result('blocked', {blockers: ['live_dispatch_not_enabled'], baseline_hash: baselineHash});
  const correlation = {request_id: p.request_id, context_epoch: p.context_epoch,
    packet_hash: prepared.packet_hash, body_hash: prepared.body_hash,
    baseline_hash: baselineHash, provider: 'gemini', model: GEMINI_SHADOW.model};
  let journal;
  try { journal = reserve(receiptDirectory, {event: 'pending', ...correlation, at_ms: Date.now()}); }
  catch (e) { return result(e.code === 'ATTEMPT_RESERVED' ? 'attempt_already_reserved' : 'receipt_unavailable', {baseline_hash: baselineHash}); }
  const controller = new AbortController();
  let timer;
  const timeout = new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve({status: 'timed_out_uncertain', usage: null}); }, Math.max(0, GEMINI_SHADOW.deadlineMs - (performance.now() - start))); });
  const work = async () => {
    try {
      // Recheck expiry after the durable reservation, immediately before transmission.
      if (performance.now() - start >= GEMINI_SHADOW.deadlineMs) return {status: 'deadline_before_dispatch', usage: null};
      if (geminiShadowBlockers(prepared, apiKey, a).length) return {status: 'preflight_expired', usage: null};
      const response = await fetchImpl(endpoint, {method: 'POST', redirect: 'error', signal: controller.signal,
        headers: {'content-type': 'application/json', 'x-goog-api-key': apiKey}, body: JSON.stringify(prepared.body)});
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        return {status: response.status === 401 || response.status === 403 ? 'access_denied' : response.status === 429 ? 'quota_exhausted' : response.status >= 500 ? 'provider_unavailable' : 'provider_rejected', usage: null};
      }
      const raw = await boundedJson(response);
      if (JSON.stringify(raw).includes(apiKey) || raw?.modelVersion !== GEMINI_SHADOW.responseVersion) return {status: 'invalid_response', usage: null};
      // Alias/version mapping is explicit; do not rewrite provider model identity.
      const normalized = adapter.normalize(raw, GEMINI_SHADOW.responseVersion);
      const u = normalized.usage;
      if (!u || !integer(u.input_total) || !integer(u.output_total) || !integer(u.reasoning_output)) return {status: 'accounting_uncertain', usage: null};
      if (u.input_total > a.input_accounting.upper_bound || u.input_total > GEMINI_SHADOW.inputTokens || u.output_total > GEMINI_SHADOW.outputTokens) return {status: 'token_bound_violation', usage: u};
      if (!integer(raw.usageMetadata.totalTokenCount) || raw.usageMetadata.totalTokenCount !== u.input_total + u.output_total || (raw.usageMetadata.toolUsePromptTokenCount ?? 0) !== 0) return {status: 'accounting_uncertain', usage: u};
      if (normalized.status !== 'candidate') return {status: normalized.status, usage: u};
      if (!validateCandidate(normalized.candidate, p, l).valid) return {status: 'invalid_candidate', usage: u};
      return {status: 'valid_shadow', usage: u, candidate: normalized.candidate};
    } catch { return {status: controller.signal.aborted ? 'timed_out_uncertain' : 'transport_or_response_error', usage: null}; }
  };
  let outcome = await Promise.race([work(), timeout]);
  clearTimeout(timer);
  // Late work has no journal or mutable-result access. Deadline includes body reception.
  if (performance.now() - start >= GEMINI_SHADOW.deadlineMs) { controller.abort(); outcome = {status: 'timed_out_uncertain', usage: null}; }
  const receipt = {event: 'terminal', ...correlation, status: outcome.status, usage: outcome.usage,
    elapsed_ms: Math.ceil(performance.now() - start), authorized_usd: 0,
    billed_cost_verified: false, at_ms: Date.now(), adopted: false};
  try { journal.append(receipt); }
  catch { return result('receipt_write_failed', {baseline_hash: baselineHash}); }
  finally { try { journal.close(); } catch { /* An already-fsynced record is reconciled separately. */ } }
  return result(outcome.status, {baseline_hash: baselineHash, receipt,
    shadow_candidate: outcome.status === 'valid_shadow' ? outcome.candidate : null});
}

export function reconcileGeminiShadow(directory = receiptRoot) {
  try {
    const file = path.join(directory, 'gemini-canary.jsonl');
    if (fs.statSync(file).size > 16384) return {status: 'receipt_invalid', complete: false};
    const entries = fs.readFileSync(file, 'utf8').trim().split('\n').map(s => JSON.parse(s));
    const [start, end] = entries;
    if (entries.length === 1 && start.event === 'pending') return {status: 'uncertain_completion', complete: false};
    const keys = ['request_id', 'context_epoch', 'packet_hash', 'body_hash', 'baseline_hash', 'provider', 'model'];
    if (entries.length !== 2 || start.event !== 'pending' || end.event !== 'terminal' || keys.some(k => start[k] !== end[k])) return {status: 'receipt_invalid', complete: false};
    return {status: end.status, complete: true, successful_shadow: end.status === 'valid_shadow'};
  } catch { return {status: 'receipt_missing_or_invalid', complete: false}; }
}
