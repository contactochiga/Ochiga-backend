// Experiment-only preparation/final-check boundary. No CLI, ambient network,
// credential lookup, reservation reset, automatic approval or clock extension.
import fs from 'node:fs';
import path from 'node:path';
import {ROOT, hash, canonicalSources} from '../iq11e/contract.mjs';
import {GEMINI_COMPATIBILITY as binding} from './gemini-compatibility-policy.mjs';
import {GEMINI_SHADOW as policy, prepareGeminiShadow, geminiCompatibilityBlockers,
  runGeminiCompatibility} from './gemini-shadow.mjs';

const codeFiles = ['gemini-approval-workflow.mjs', 'gemini-shadow.mjs',
  'gemini-request.mjs', 'gemini-owner-authorization.mjs',
  'gemini-compatibility-policy.mjs', 'registry.mjs', 'adapters/gemini.mjs', 'adapters/common.mjs'];
export const workflowSourceHash = () => hash([
  ...codeFiles.map(file => [file, hash(fs.readFileSync(path.join(ROOT, 'scripts/iq11f-gateway', file), 'utf8'))]),
  ['iq11e/contract.mjs', hash(fs.readFileSync(path.join(ROOT, 'scripts/iq11e/contract.mjs'), 'utf8'))],
  ...canonicalSources.map(({path: file}) => [file, hash(fs.readFileSync(path.join(ROOT, file), 'utf8'))]),
]);
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export function allowanceState() {
  // Any file, including a dangling symlink or incomplete receipt, blocks. Never reset.
  for (const directory of ['iq11f-gemini-compatibility-receipts', 'iq11f-gemini-shadow-receipts']) {
    try { fs.lstatSync(path.join(ROOT, 'artifacts', directory, 'gemini-canary.jsonl')); return 'RESERVED_OR_UNCERTAIN'; }
    catch (error) { if (error.code !== 'ENOENT') return 'UNVERIFIABLE'; }
  }
  return 'UNUSED';
}

// Call only after offline suites/review finish, immediately before requesting
// approval. reviewHash identifies sanitized test/security preparation evidence.
export function sealPreparedCanary(packet, reviewHash, now = Date.now()) {
  if (!hex(reviewHash) || allowanceState() !== 'UNUSED') throw Error('preparation_not_ready');
  const p = structuredClone(packet), prepared = prepareGeminiShadow(p);
  for (const field of ['packet_hash', 'body_hash', 'schema_hash']) {
    if (prepared[field] !== binding[field]) throw Error('request_not_pinned');
  }
  if (Date.parse(p.now) > now || now >= Date.parse(p.now) + 300000 ||
      p.entities.some(e => Date.parse(e.expires_at) <= now || e.facts.some(f => Date.parse(f.expires_at) <= now))) throw Error('packet_expired');
  return freeze({version: 1, status: 'PREPARED_NOT_AUTHORIZED', project: policy.project,
    model: policy.model, approval_id: binding.approval_id, experiment_id: binding.experiment_id,
    packet: p, wire_body: JSON.stringify(prepared.body), packet_hash: prepared.packet_hash,
    body_hash: prepared.body_hash, schema_hash: prepared.schema_hash,
    preparation_review_hash: reviewHash, source_hash: workflowSourceHash(),
    prepared_at_ms: now, packet_deadline_ms: Date.parse(p.now) + 300000,
    approval_max_validity_ms: 300000, input_accounting_verified: false,
    qualification_gate: 4096, counts_toward_certification: false});
}

// verification is a TRUSTED operator read-only observation, not provider output.
// A key hash alone proves no project ownership: verified matching-key evidence is
// mandatory. Neither the key nor its in-memory digest belongs in saved artifacts.
export function preparedDispatchBlockers(bundle, approval, verification, apiKey, now = Date.now()) {
  try {
    const reasons = [], prepared = prepareGeminiShadow(bundle.packet);
    if (bundle.status !== 'PREPARED_NOT_AUTHORIZED' || bundle.project !== policy.project ||
        bundle.model !== policy.model || bundle.approval_id !== binding.approval_id ||
        bundle.experiment_id !== binding.experiment_id || !hex(bundle.preparation_review_hash) ||
        bundle.source_hash !== workflowSourceHash()) reasons.push('preparation_changed');
    for (const field of ['packet_hash', 'body_hash', 'schema_hash']) {
      if (bundle[field] !== prepared[field] || bundle[field] !== binding[field]) reasons.push('prepared_hash_mismatch');
    }
    if (bundle.wire_body !== JSON.stringify(prepared.body) || hash(bundle.wire_body) !== bundle.body_hash) reasons.push('prepared_wire_mismatch');
    if (bundle.packet_deadline_ms !== Date.parse(bundle.packet.now) + 300000 ||
        now >= bundle.packet_deadline_ms || Date.parse(bundle.packet.now) > now ||
        bundle.packet.entities.some(e => Date.parse(e.expires_at) <= now || e.facts.some(f => Date.parse(f.expires_at) <= now))) reasons.push('packet_expired');
    reasons.push(...geminiCompatibilityBlockers(prepared, apiKey, approval, now));
    if (!approval || approval.verified_at_ms < bundle.prepared_at_ms ||
        approval.expires_at_ms > bundle.packet_deadline_ms) reasons.push('approval_window_invalid');
    const v = verification;
    if (!v || !Number.isSafeInteger(v.observed_at_ms) || v.observed_at_ms < approval?.verified_at_ms ||
        v.observed_at_ms > now || now - v.observed_at_ms >= 300000) reasons.push('fresh_verification_required');
    if (!v || v.project !== policy.project || v.model !== policy.model ||
        v.credential_match_verified !== true || !hex(v.ownership_evidence_hash) ||
        v.credential_sha256 !== hash(apiKey || '') ||
        v.credential_sha256 !== approval?.credential_sha256 ||
        v.ownership_evidence_hash !== approval?.ownership_evidence_hash) reasons.push('fresh_credential_binding_required');
    if (!v || v.tier !== 'FREE' || v.billing_account_linked !== false || v.billing_enabled !== false ||
        !hex(v.billing_quota_evidence_hash) || v.billing_quota_evidence_hash !== approval?.billing_quota_evidence_hash ||
        !['rpm', 'tpm', 'rpd'].every(k => Number.isSafeInteger(v.quota_remaining?.[k]) && v.quota_remaining[k] > 0)) reasons.push('fresh_billing_quota_required');
    if (allowanceState() !== 'UNUSED') reasons.push('attempt_reserved_or_unverifiable');
    return [...new Set(reasons)];
  } catch { return ['invalid_prepared_dispatch']; }
}

export async function dispatchPreparedCanary({bundle, approval, verification, apiKey, baseline, locks = {}}, options = {}) {
  // Capture before asynchronous work. No work beyond final checks and reviewed
  // transport; never run tests, browse, refresh timestamps or rebuild packet here.
  const b = structuredClone(bundle), a = structuredClone(approval), v = structuredClone(verification);
  const blockers = preparedDispatchBlockers(b, a, v, apiKey);
  if (blockers.length) return {status: 'blocked', blockers, adopted: false, counts_toward_certification: false};
  return runGeminiCompatibility({packet: b.packet, wireBody: b.wire_body,
    approval: a, apiKey, baseline, locks}, options);
}
