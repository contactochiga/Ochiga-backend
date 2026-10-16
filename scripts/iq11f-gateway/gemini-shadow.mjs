// Experiment transport only. Never import from src; no CLI, ambient-key lookup or auto-run.
import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {ROOT, hash, validateCandidate} from '../iq11e/contract.mjs';
import {defaultRegistry} from './registry.mjs';
import {GEMINI_COMPATIBILITY} from './gemini-compatibility-policy.mjs';
import {executionBindingBlockers, ordinaryGeminiAllowanceUnused} from './gemini-owner-authorization.mjs';

import {GEMINI_SHADOW, prepareGeminiShadow} from './gemini-request.mjs';
export {GEMINI_SHADOW, prepareGeminiShadow} from './gemini-request.mjs';
const adapter = defaultRegistry().get('gemini');
const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_SHADOW.model}:generateContent`;
const receiptRoot = path.join(ROOT, 'artifacts/iq11f-gemini-shadow-receipts');
const compatibilityReceiptRoot = path.join(ROOT, 'artifacts/iq11f-gemini-compatibility-receipts');
const digest = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const integer = x => Number.isSafeInteger(x) && x >= 0;
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const result = (status, extra = {}) => freeze({status, adopted: false, canonical_decision_changed: false, shadow_candidate: null, ...extra});

// Approval is a TRUSTED operator preflight result, never a model/user packet field.
// This module cannot establish Google ownership or billing from an API key alone.
// No real approval is supplied by this change; mock proofs are not live evidence.
function commonGeminiBlockers(prepared, apiKey, approval, now) {
  const a = approval, reasons = [];
  if (typeof apiKey !== 'string' || !apiKey.trim()) reasons.push('credential_missing');
  if (!a) return [...reasons, 'canary_not_approved'];
  if (a.provider !== 'gemini' || a.project !== GEMINI_SHADOW.project || a.model !== GEMINI_SHADOW.model || a.response_version !== GEMINI_SHADOW.responseVersion) reasons.push('recipient_or_model_mismatch');
  if (!digest(a.credential_sha256) || a.credential_sha256 !== hash(apiKey || '')) reasons.push('credential_binding_missing');
  if (a.ownership_verified !== true || !digest(a.ownership_evidence_hash)) reasons.push('ownership_unverified');
  if (a.tier !== 'FREE' || a.billing_enabled !== false || a.free_quota_verified !== true || !digest(a.billing_quota_evidence_hash) || a.input_usd_per_token !== 0 || a.output_usd_per_token !== 0 || a.authorized_usd !== 0) reasons.push('zero_cost_unverified');
  if (a.synthetic_reviewed !== true || a.data_processing_approved !== true || a.packet_hash !== prepared.packet_hash || a.body_hash !== prepared.body_hash || a.schema_hash !== prepared.schema_hash) reasons.push('packet_or_policy_not_approved');
  if (!Number.isFinite(a.verified_at_ms) || !Number.isFinite(a.expires_at_ms) || a.verified_at_ms > now || a.expires_at_ms <= now || a.expires_at_ms - a.verified_at_ms > 300000) reasons.push('preflight_expired');
  if (a.max_inference_requests !== 1 || a.output_tokens !== GEMINI_SHADOW.outputTokens || a.deadline_ms !== GEMINI_SHADOW.deadlineMs || a.allow_tools !== false || a.allow_fallback !== false) reasons.push('limits_not_approved');
  return reasons;
}

export function geminiShadowBlockers(prepared, apiKey, approval, now = Date.now()) {
  const a = approval, reasons = commonGeminiBlockers(prepared, apiKey, a, now);
  if (!a || a.live_canary_approved !== true) return [...reasons, 'canary_not_approved'];
  if (a.compatibility_canary_approved === true) reasons.push('exception_not_qualification');
  const t = a.input_accounting;
  // Require an independently established upper bound INCLUDING system + schema + framing.
  // chars/4, content-only counts and unknown schema overhead do not qualify.
  if (!t || t.body_hash !== prepared.body_hash || t.model !== GEMINI_SHADOW.model || t.full_request_verified !== true || !digest(t.evidence_hash) || !integer(t.upper_bound) || t.upper_bound < 1 || t.upper_bound > GEMINI_SHADOW.inputTokens) reasons.push('input_accounting_unverified');
  return reasons;
}

// Explicit compatibility-only admission. Never manufacture a token proof or promote
// compatibility into ordinary qualification. These are trusted operator attestations,
// not a way to prove Google's billing state or genuine human approval from booleans.
export function geminiCompatibilityBlockers(prepared, apiKey, approval, now = Date.now()) {
  const a = approval, reasons = commonGeminiBlockers(prepared, apiKey, a, now);
  if (!a || a.compatibility_canary_approved !== true) return [...reasons, 'compatibility_not_approved'];
  if (a.live_canary_approved !== false || a.exception_type !== GEMINI_COMPATIBILITY.exception_type ||
      a.experiment_id !== GEMINI_COMPATIBILITY.experiment_id || a.approval_id !== GEMINI_COMPATIBILITY.approval_id ||
      !digest(a.owner_approval_evidence_hash)) reasons.push('exception_approval_mismatch');
  if (a.execution_authorization_hash) reasons.push(...executionBindingBlockers(prepared, a, apiKey, now));
  else for (const field of ['packet_hash', 'body_hash', 'schema_hash']) {
    if (prepared[field] !== GEMINI_COMPATIBILITY[field] || a[field] !== GEMINI_COMPATIBILITY[field]) reasons.push('exception_request_not_pinned');
  }
  const t = a.input_accounting;
  if (!t || t.body_hash !== prepared.body_hash || t.model !== GEMINI_SHADOW.model ||
      t.full_request_verified !== false || t.upper_bound !== null || t.qualification_gate !== GEMINI_SHADOW.inputTokens ||
      a.accept_unverified_input_for_compatibility !== true || a.counts_toward_certification !== false) reasons.push('exception_accounting_not_honest');
  if (a.accept_google_free_tier_processing !== true || a.accept_external_billing_enforcement !== true ||
      a.accept_remote_completion_uncertainty !== true || a.allow_retries !== false) reasons.push('exception_risk_not_approved');
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
  return runGeminiRead({packet, baseline, locks, approval, apiKey}, {fetchImpl, receiptDirectory}, false);
}

// No CLI, environment-key lookup, ambient fetch or Core/action callback. The fixed
// ledger is shared by all approvals/hashes for this experiment, including failures.
// An injected fetchImpl is trusted test/transport code, not a security sandbox.
export async function runGeminiCompatibility(input, options = {}) {
  const metadata = {experiment_kind: 'schema_compatibility_exception', counts_toward_certification: false,
    qualification_gate: GEMINI_SHADOW.inputTokens, input_accounting_verified: false, qualification_status: 'UNRESOLVED'};
  if (!input || typeof input !== 'object' || Array.isArray(input) || !options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(input).some(k => !['packet', 'baseline', 'locks', 'approval', 'apiKey', 'wireBody'].includes(k)) ||
      Object.keys(options).some(k => k !== 'fetchImpl')) return result('blocked', {...metadata, blockers: ['unexpected_compatibility_argument']});
  const out = await runGeminiRead({locks: {}, approval: null, ...input},
    {fetchImpl: options.fetchImpl, receiptDirectory: compatibilityReceiptRoot}, true);
  return freeze({...out, ...metadata, shadow_candidate: null});
}

async function runGeminiRead({packet, baseline, locks, approval, apiKey, wireBody}, {fetchImpl, receiptDirectory}, compatibility) {
  const start = performance.now();
  let p, a, l, prepared, baselineHash;
  try {
    // Capture before asynchronous work so subsequent caller mutation cannot alter admission.
    p = structuredClone(packet); a = structuredClone(approval); l = structuredClone(locks);
    baselineHash = hash(baseline); prepared = prepareGeminiShadow(p);
  } catch { return result('invalid_input'); }
  // Historical exact-hash flags are still inspectable, but no compatibility
  // dispatch can bypass signed owner consent and the fixed execution record.
  const admission = compatibility ? (p, key, a) => [...new Set([
    ...geminiCompatibilityBlockers(p, key, a), ...executionBindingBlockers(p, a, key),
  ])] : geminiShadowBlockers;
  const blockers = admission(prepared, apiKey, a);
  if (compatibility && !ordinaryGeminiAllowanceUnused()) blockers.push('ordinary_attempt_reserved_or_unverifiable');
  // A prepared compatibility packet is sent byte-for-byte, never refreshed after
  // approval. Canonical recomputation here is validation only, not packet mutation.
  const bodyBytes = JSON.stringify(prepared.body);
  if (wireBody !== undefined && (!compatibility || typeof wireBody !== 'string' || wireBody !== bodyBytes)) blockers.push('prepared_wire_mismatch');
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
    baseline_hash: baselineHash, provider: 'gemini', model: GEMINI_SHADOW.model,
    ...(compatibility ? {experiment_kind: 'schema_compatibility_exception', experiment_id: GEMINI_COMPATIBILITY.experiment_id,
      approval_id: a.approval_id, schema_hash: prepared.schema_hash, input_accounting_verified: false,
      execution_authorization_hash: a.execution_authorization_hash, owner_authorization_hash: a.owner_approval_evidence_hash,
      qualification_gate: GEMINI_SHADOW.inputTokens, counts_toward_certification: false} : {})};
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
      if (admission(prepared, apiKey, a).length) return {status: 'preflight_expired', usage: null};
      const response = await fetchImpl(endpoint, {method: 'POST', redirect: 'error', signal: controller.signal,
        headers: {'content-type': 'application/json', 'x-goog-api-key': apiKey}, body: wireBody ?? bodyBytes});
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
      if ((!compatibility && u.input_total > a.input_accounting.upper_bound) || u.input_total > GEMINI_SHADOW.inputTokens || u.output_total > GEMINI_SHADOW.outputTokens) return {status: 'token_bound_violation', usage: u};
      if (!integer(raw.usageMetadata.totalTokenCount) || raw.usageMetadata.totalTokenCount !== u.input_total + u.output_total || (raw.usageMetadata.toolUsePromptTokenCount ?? 0) !== 0) return {status: 'accounting_uncertain', usage: u};
      if (normalized.status !== 'candidate') return {status: normalized.status, usage: u};
      if (!validateCandidate(normalized.candidate, p, l).valid) return {status: 'invalid_candidate', usage: u};
      return compatibility ? {status: 'compatible_unqualified', usage: u} : {status: 'valid_shadow', usage: u, candidate: normalized.candidate};
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
    if (start.experiment_kind || end?.experiment_kind) {
      keys.push('experiment_kind', 'experiment_id', 'approval_id', 'schema_hash', 'qualification_gate', 'input_accounting_verified', 'counts_toward_certification');
      if (start.execution_authorization_hash || end?.execution_authorization_hash) keys.push('execution_authorization_hash', 'owner_authorization_hash');
      if (start.experiment_kind !== 'schema_compatibility_exception' || start.experiment_id !== GEMINI_COMPATIBILITY.experiment_id ||
          start.approval_id !== GEMINI_COMPATIBILITY.approval_id || start.qualification_gate !== GEMINI_SHADOW.inputTokens ||
          start.input_accounting_verified !== false || start.counts_toward_certification !== false ||
          end?.status === 'valid_shadow') return {status: 'receipt_invalid', complete: false};
    }
    if (entries.length !== 2 || start.event !== 'pending' || end.event !== 'terminal' || keys.some(k => start[k] !== end[k])) return {status: 'receipt_invalid', complete: false};
    return {status: end.status, complete: true, successful_shadow: end.status === 'valid_shadow',
      ...(start.experiment_kind ? {experiment_kind: start.experiment_kind} : {})};
  } catch { return {status: 'receipt_missing_or_invalid', complete: false}; }
}

export function reconcileGeminiCompatibility() {
  const r = reconcileGeminiShadow(compatibilityReceiptRoot);
  // An ordinary journal in this directory can never establish compatibility success.
  return {...r, successful_shadow: false, counts_toward_certification: false, input_accounting_verified: false,
    compatibility_observed: r.complete === true && r.experiment_kind === 'schema_compatibility_exception' && r.status === 'compatible_unqualified'};
}
