// Experiment-only owner consent and single execution-window issuance. No signing,
// network, environment credential lookup, alternate trust path or renewal API.
import fs from 'node:fs';
import path from 'node:path';
import {createPublicKey, verify} from 'node:crypto';
import {ROOT, hash} from '../iq11e/contract.mjs';
import {GEMINI_SHADOW as policy, prepareGeminiShadow} from './gemini-request.mjs';
import {GEMINI_COMPATIBILITY as binding} from './gemini-compatibility-policy.mjs';

const artifacts = path.join(ROOT, 'artifacts');
const trustFile = path.join(artifacts, 'intelligence-quality-v1-iq11f-gemini-owner-trust.json');
const constraintsFile = path.join(artifacts, 'intelligence-quality-v1-iq11f-gemini-owner-constraints.json');
const directory = path.join(artifacts, 'iq11f-gemini-execution-authorization');
const executionFile = path.join(directory, 'execution.json');
const claimKeys = ['version', 'purpose', 'authorization_id', 'key_id', 'issued_at_ms', 'expires_at_ms', 'constraint_sha256', 'approval_id'];
const hex = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const exactKeys = (x, keys) => !!x && typeof x === 'object' && !Array.isArray(x) &&
  Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const canonical = x => JSON.stringify(Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])));
function readJson(file, limit = 65536) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw Error('invalid_authorization_storage');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
const absent = file => { try { fs.lstatSync(file); return false; } catch (e) { return e.code === 'ENOENT'; } };
export function inferenceAllowanceUnused() {
  return ['iq11f-gemini-compatibility-receipts', 'iq11f-gemini-shadow-receipts']
    .every(dir => absent(path.join(artifacts, dir, 'gemini-canary.jsonl')));
}
export function ordinaryGeminiAllowanceUnused() {
  return absent(path.join(artifacts, 'iq11f-gemini-shadow-receipts/gemini-canary.jsonl'));
}
export function ownerConstraints() {
  const c = readJson(constraintsFile);
  if (hash(c.policy) !== hash(policy) || c.approval_id !== binding.approval_id ||
      c.experiment_id !== binding.experiment_id || c.exception_type !== binding.exception_type ||
      c.provider !== 'gemini' || c.schema_hash !== '45bef064beadba0002b060d36b681eab0a8e6c14ccd174ec98d62e37730cb3e3' ||
      c.execution_window_ms !== 300000 || c.fact_lifetime_ms !== 1800000 ||
      c.max_owner_validity_ms !== 2592000000 || c.max_inference_attempts !== 1 ||
      ['no_retries', 'no_fallback', 'no_tools', 'no_grounding', 'no_execution_callbacks', 'no_production_adoption',
        'accept_google_free_tier_processing', 'accept_external_billing_enforcement', 'accept_remote_completion_uncertainty'].some(k => c[k] !== true) ||
      c.input_accounting_verified !== false || c.counts_toward_certification !== false) throw Error('constraint_drift');
  const p = prepareGeminiShadow(c.template_packet);
  if (p.body_hash !== c.normalized_body_hash || p.schema_hash !== c.schema_hash) throw Error('serialization_drift');
  return c;
}
export function ownerAuthorizationMessage(claims) {
  if (!exactKeys(claims, claimKeys)) throw Error('invalid_owner_claims');
  return 'OYI-IQ11F-OWNER-AUTHORIZATION-V1\n' + canonical(claims);
}
export function verifyOwnerAuthorization(owner, now = Date.now()) {
  try {
    if (!exactKeys(owner, ['claims', 'signature']) || typeof owner.signature !== 'string' ||
        !/^[A-Za-z0-9+/]{86}==$/.test(owner.signature)) throw Error('invalid_owner_signature');
    const c = ownerConstraints(), t = readJson(trustFile, 4096), a = owner.claims;
    if (t.version !== 1 || t.enrolled !== true || typeof t.key_id !== 'string' || typeof t.public_key_pem !== 'string') throw Error('owner_trust_not_enrolled');
    if (!exactKeys(a, claimKeys) || a.version !== 1 || a.purpose !== c.purpose || a.approval_id !== c.approval_id ||
        a.key_id !== t.key_id || a.constraint_sha256 !== hash(c) || typeof a.authorization_id !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(a.authorization_id) ||
        !Number.isSafeInteger(a.issued_at_ms) || !Number.isSafeInteger(a.expires_at_ms) ||
        a.issued_at_ms > now || a.expires_at_ms <= now || a.expires_at_ms <= a.issued_at_ms ||
        a.expires_at_ms - a.issued_at_ms > c.max_owner_validity_ms) throw Error('invalid_owner_claims');
    const key = createPublicKey(t.public_key_pem);
    if (key.asymmetricKeyType !== 'ed25519' || !verify(null, Buffer.from(ownerAuthorizationMessage(a)), key,
      Buffer.from(owner.signature, 'base64'))) throw Error('invalid_owner_signature');
    return {valid: true, owner_hash: hash(owner), constraints: c};
  } catch (e) {
    const known = ['owner_trust_not_enrolled', 'invalid_owner_signature', 'invalid_owner_claims', 'constraint_drift', 'serialization_drift'];
    return {valid: false, reason: known.includes(e.message) ? e.message : 'owner_authorization_unverifiable'};
  }
}
function refreshedPacket(c, now) {
  const p = structuredClone(c.template_packet);
  p.now = new Date(now).toISOString();
  // Exact approved structure only: no loop widening to additional entities/facts.
  p.entities[0].expires_at = new Date(now + c.fact_lifetime_ms).toISOString();
  p.entities[0].facts[0].expires_at = p.entities[0].expires_at;
  p.entities[0].facts[1].expires_at = p.entities[0].expires_at;
  return p;
}
export function freshGeminiEvidenceBlockers(v, apiKey, now = Date.now()) {
  const reasons = [];
  if (!v || !Number.isSafeInteger(v.observed_at_ms) || v.observed_at_ms > now || now - v.observed_at_ms >= 300000) reasons.push('fresh_evidence_required');
  if (typeof apiKey !== 'string' || !apiKey.trim() || v?.project !== policy.project || v?.model !== policy.model ||
      v?.credential_match_verified !== true || v?.credential_sha256 !== hash(apiKey || '') || !hex(v?.ownership_evidence_hash)) reasons.push('credential_project_binding_required');
  if (v?.tier !== 'FREE' || v?.billing_account_linked !== false || v?.billing_enabled !== false ||
      !hex(v?.billing_quota_evidence_hash) || !['rpm', 'tpm', 'rpd'].every(k => Number.isSafeInteger(v?.quota_remaining?.[k]) && v.quota_remaining[k] > 0)) reasons.push('billing_quota_unverified');
  return reasons;
}
export function issueGeminiExecution(owner, verification, apiKey) {
  const now = Date.now(), checked = verifyOwnerAuthorization(owner, now);
  if (!checked.valid) return {status: 'blocked', blockers: [checked.reason]};
  const blockers = freshGeminiEvidenceBlockers(verification, apiKey, now);
  if (!inferenceAllowanceUnused()) blockers.push('inference_already_reserved_or_unverifiable');
  if (!absent(executionFile)) blockers.push('execution_already_issued_or_unverifiable');
  if (blockers.length) return {status: 'blocked', blockers};
  const packet = refreshedPacket(checked.constraints, now), prepared = prepareGeminiShadow(packet);
  const record = {version: 1, owner: structuredClone(owner), owner_hash: checked.owner_hash,
    constraint_sha256: hash(checked.constraints), issued_at_ms: now,
    expires_at_ms: Math.min(now + 300000, owner.claims.expires_at_ms),
    packet, wire_body: JSON.stringify(prepared.body), packet_hash: prepared.packet_hash,
    body_hash: prepared.body_hash, schema_hash: prepared.schema_hash};
  let fd;
  try {
    fs.mkdirSync(directory, {recursive: true, mode: 0o700});
    fd = fs.openSync(executionFile, 'wx', 0o600);
    const bytes = Buffer.from(JSON.stringify(record) + '\n'); let offset = 0;
    while (offset < bytes.length) offset += fs.writeSync(fd, bytes, offset, bytes.length - offset);
    fs.fsyncSync(fd);
    const parent = fs.openSync(directory, 'r');
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
    return {status: 'issued', execution_hash: hash(record), body_hash: record.body_hash,
      schema_hash: record.schema_hash, expires_at_ms: record.expires_at_ms};
  } catch { return {status: 'blocked', blockers: ['execution_storage_failed_or_already_issued']}; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function executionRecord(now) {
  const r = readJson(executionFile), checked = verifyOwnerAuthorization(r.owner, now);
  if (!checked.valid) throw Error(checked.reason);
  if (!exactKeys(r, ['version', 'owner', 'owner_hash', 'constraint_sha256', 'issued_at_ms', 'expires_at_ms', 'packet', 'wire_body', 'packet_hash', 'body_hash', 'schema_hash']) ||
      r.version !== 1 || r.owner_hash !== checked.owner_hash || r.constraint_sha256 !== hash(checked.constraints) ||
      !Number.isSafeInteger(r.issued_at_ms) || r.issued_at_ms < r.owner.claims.issued_at_ms || r.issued_at_ms > now ||
      r.expires_at_ms !== Math.min(r.issued_at_ms + 300000, r.owner.claims.expires_at_ms) || r.expires_at_ms <= now) throw Error('invalid_or_expired_execution');
  const p = refreshedPacket(checked.constraints, r.issued_at_ms), prepared = prepareGeminiShadow(p);
  if (hash(p) !== hash(r.packet) || r.wire_body !== JSON.stringify(prepared.body) ||
      ['packet_hash', 'body_hash', 'schema_hash'].some(k => r[k] !== prepared[k])) throw Error('execution_tampered');
  return r;
}
export function loadGeminiExecution(verification, apiKey) {
  try {
    const now = Date.now(), r = executionRecord(now);
    const blockers = freshGeminiEvidenceBlockers(verification, apiKey, now);
    if (!inferenceAllowanceUnused()) blockers.push('inference_already_reserved_or_unverifiable');
    if (blockers.length) return {status: 'blocked', blockers};
    const a = {live_canary_approved: false, compatibility_canary_approved: true,
      ...binding, packet_hash: r.packet_hash, body_hash: r.body_hash, schema_hash: r.schema_hash,
      execution_authorization_hash: hash(r), owner_approval_evidence_hash: r.owner_hash,
      provider: 'gemini', project: policy.project, model: policy.model, response_version: policy.responseVersion,
      credential_sha256: hash(apiKey), ownership_verified: true, ownership_evidence_hash: verification.ownership_evidence_hash,
      tier: 'FREE', billing_enabled: false, free_quota_verified: true, billing_quota_evidence_hash: verification.billing_quota_evidence_hash,
      input_usd_per_token: 0, output_usd_per_token: 0, authorized_usd: 0,
      synthetic_reviewed: true, data_processing_approved: true,
      verified_at_ms: r.issued_at_ms, expires_at_ms: r.expires_at_ms,
      input_accounting: {body_hash: r.body_hash, model: policy.model, full_request_verified: false, upper_bound: null, qualification_gate: 4096},
      accept_unverified_input_for_compatibility: true, counts_toward_certification: false,
      accept_google_free_tier_processing: true, accept_external_billing_enforcement: true, accept_remote_completion_uncertainty: true,
      max_inference_requests: 1, output_tokens: 1024, deadline_ms: 3000, allow_tools: false, allow_fallback: false, allow_retries: false,
      fresh_verification: structuredClone(verification)};
    return {status: 'ready', packet: r.packet, wireBody: r.wire_body, approval: a};
  } catch { return {status: 'blocked', blockers: ['execution_unverifiable_or_expired']}; }
}
export function executionBindingBlockers(prepared, approval, apiKey, now = Date.now()) {
  try {
    const r = executionRecord(now);
    if (approval?.execution_authorization_hash !== hash(r) || approval?.owner_approval_evidence_hash !== r.owner_hash ||
        approval?.verified_at_ms !== r.issued_at_ms || approval?.expires_at_ms !== r.expires_at_ms ||
        ['packet_hash', 'body_hash', 'schema_hash'].some(k => prepared[k] !== r[k] || approval?.[k] !== r[k])) return ['execution_binding_mismatch'];
    const v = approval.fresh_verification;
    const blockers = freshGeminiEvidenceBlockers(v, apiKey, now);
    if (v?.ownership_evidence_hash !== approval.ownership_evidence_hash || v?.billing_quota_evidence_hash !== approval.billing_quota_evidence_hash) blockers.push('fresh_evidence_binding_mismatch');
    return blockers;
  } catch { return ['signed_owner_and_execution_required']; }
}
