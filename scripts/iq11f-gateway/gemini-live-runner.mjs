// Isolated, owner-operated experiment entry point. Never import from production src.
// Import and `preflight` cannot issue execution authorization or send inference.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {pathToFileURL} from 'node:url';
import {ROOT, hash} from '../iq11e/contract.mjs';
import {GEMINI_SHADOW as policy} from './gemini-request.mjs';
import {verifyOwnerAuthorization, inferenceAllowanceUnused, freshGeminiEvidenceBlockers,
  issueGeminiExecution, loadGeminiExecution} from './gemini-owner-authorization.mjs';
import {runGeminiCompatibility} from './gemini-shadow.mjs';

const handles = new WeakMap();
const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${policy.model}:generateContent`;
const signedFile = path.join(ROOT, 'artifacts/intelligence-quality-v1-iq11f-gemini-owner-manifest-001.signed.json');
const executionFile = path.join(ROOT, 'artifacts/iq11f-gemini-execution-authorization/execution.json');
const blocked = (...blockers) => ({status: 'blocked', blockers, inference_dispatched: false});
function executionAbsent() {
  try { fs.lstatSync(executionFile); return false; } catch (e) { return e.code === 'ENOENT'; }
}
export function readSignedOwner() {
  const s = fs.lstatSync(signedFile);
  if (!s.isFile() || s.isSymbolicLink() || s.size > 16384) throw Error('invalid_owner_storage');
  return JSON.parse(fs.readFileSync(signedFile, 'utf8'));
}

// Full comparison occurs inside the masked-dialog process. Neither credential is
// in argv, stdout, stderr, files, receipts or diagnostics. No clipboard access.
// Project selection remains an explicit owner attestation, not Google IAM proof.
export function compareCredentialLocally(apiKey) {
  if (process.platform !== 'darwin' || !process.stdin.isTTY || !process.stdout.isTTY || !apiKey) return false;
  const script = `ObjC.import('Foundation');
    var app = Application.currentApplication(); app.includeStandardAdditions = true;
    try {
      var entered = app.displayDialog('Paste the existing API key from Oyi Intelligence Development, project gen-lang-client-0414833380. This is a local full-key comparison only.',
        {defaultAnswer:'', hiddenAnswer:true, buttons:['Cancel','Compare'], defaultButton:'Compare', cancelButton:'Cancel'}).textReturned;
      var expected = ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey('GEMINI_API_KEY'));
      entered.length > 0 && entered === expected ? 'FULL_KEY_MATCH' : 'NO_MATCH';
    } catch (_) { 'NO_MATCH'; }`;
  try {
    const r = spawnSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], {
      env: {...process.env, GEMINI_API_KEY: apiKey}, encoding: 'utf8', timeout: 120000, maxBuffer: 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return r.status === 0 && r.stdout.trim() === 'FULL_KEY_MATCH';
  } catch { return false; }
}

// Existing contract accepts trusted operator observations. These prompts explicitly
// label that provenance. They are NOT automatic Google verification. Unknown or
// delayed usage cannot be translated into a positive remaining quota.
export async function collectGoogleObservations(ask) {
  const observed_at_ms = Date.now();
  const exact = async (prompt, expected) => (await ask(prompt)).trim() === expected;
  if (!await exact('Read-only project ID currently selected in Google AI Studio: ', policy.project) ||
      !await exact('Exact model whose quota you are inspecting: ', policy.model) ||
      !await exact('Current project tier (FREE or UNKNOWN): ', 'FREE') ||
      !await exact('Cloud Billing linked-account page: type NO_LINKED_ACCOUNT only if explicitly shown: ', 'NO_LINKED_ACCOUNT') ||
      !await exact('Quota observation must be current, not delayed peaks/limits. Type CURRENT_REMAINING_VERIFIED or UNKNOWN: ', 'CURRENT_REMAINING_VERIFIED')) return null;
  const quota_remaining = {};
  for (const k of ['rpm', 'tpm', 'rpd']) {
    const raw = (await ask(`Verified remaining ${k} for this model (UNKNOWN if unavailable): `)).trim();
    if (!/^[1-9][0-9]{0,9}$/.test(raw)) return null;
    quota_remaining[k] = Number(raw);
  }
  return {observed_at_ms, project: policy.project, model: policy.model, tier: 'FREE',
    billing_account_linked: false, billing_enabled: false, quota_remaining,
    provenance: 'owner_read_only_google_ui_observation', current_remaining_verified: true};
}

// Observer/comparator are trusted local code ports for offline tests and owner UI,
// not serialized flags. The CLI fixes both implementations. Arbitrary hostile JS
// inside this process is outside the existing experiment trust boundary.
export async function prepareLiveCanary({owner, apiKey}, {compareCredential, observeGoogle}) {
  const checked = verifyOwnerAuthorization(owner);
  if (!checked.valid) return blocked(checked.reason);
  if (!inferenceAllowanceUnused()) return blocked('inference_already_reserved_or_unverifiable');
  if (!executionAbsent()) return blocked('execution_already_issued_or_unverifiable');
  if (typeof apiKey !== 'string' || !apiKey.trim()) return blocked('credential_missing');
  const ownerCopy = structuredClone(owner), matchedAt = Date.now();
  let observation;
  try {
    if (await compareCredential(apiKey) !== true) return blocked('credential_project_binding_required');
    observation = structuredClone(await observeGoogle());
  } catch { return blocked('preflight_observation_failed'); }
  if (observation?.provenance !== 'owner_read_only_google_ui_observation' ||
      observation?.current_remaining_verified !== true || !Number.isSafeInteger(observation.observed_at_ms) ||
      observation.observed_at_ms > Date.now()) return blocked('billing_quota_unverified');
  const verification = {...observation, observed_at_ms: Math.min(matchedAt, observation.observed_at_ms),
    credential_match_verified: true, credential_sha256: hash(apiKey),
    ownership_evidence_hash: hash({method: 'owner_masked_full_key_comparison', project: policy.project,
      owner_hash: checked.owner_hash, observed_at_ms: matchedAt}),
    billing_quota_evidence_hash: hash(observation)};
  const reasons = freshGeminiEvidenceBlockers(verification, apiKey);
  if (reasons.length) return blocked(...reasons);
  // No private material or credential digest leaves the process in the handle.
  const handle = Object.freeze({});
  handles.set(handle, {owner: ownerCopy, apiKey, verification});
  return {status: 'prepared', handle, project: policy.project, model: policy.model,
    evidence_method: observation.provenance, owner_expires_at_ms: ownerCopy.claims.expires_at_ms,
    evidence_expires_at_ms: verification.observed_at_ms + 300000, execution_issued: false};
}

export async function dispatchLiveCanary(handle) {
  const context = handle && handles.get(handle);
  if (!context) return blocked('verified_in_process_preflight_required');
  handles.delete(handle); // Conflicting calls cannot reuse even a failed preparation.
  const {owner, apiKey, verification} = context;
  const issued = issueGeminiExecution(owner, verification, apiKey);
  if (issued.status !== 'issued') return blocked(...issued.blockers);
  const ready = loadGeminiExecution(verification, apiKey);
  if (ready.status !== 'ready') return blocked(...ready.blockers);
  let used = false;
  // Exact endpoint, bytes and headers only. No redirects/retries/fallback. Existing
  // transport owns abort deadline, response bound, accounting and durable ledger.
  const controlledHttps = async (url, init) => {
    if (used || url !== endpoint || init.method !== 'POST' || init.redirect !== 'error' ||
        !(init.signal instanceof AbortSignal) || init.body !== ready.wireBody ||
        Object.keys(init.headers).sort().join(',') !== 'content-type,x-goog-api-key' ||
        init.headers['content-type'] !== 'application/json' || init.headers['x-goog-api-key'] !== apiKey ||
        freshGeminiEvidenceBlockers(verification, apiKey).length) throw Error('controlled_transport_rejected');
    used = true;
    return fetch(url, init);
  };
  return runGeminiCompatibility({packet: ready.packet, wireBody: ready.wireBody,
    approval: ready.approval, apiKey, baseline: {decision: 'deterministic_core_unchanged'}, locks: {}},
  {fetchImpl: controlledHttps});
}

async function main() {
  const mode = process.argv[2];
  if (!['preflight', 'execute'].includes(mode) || process.argv.length !== 3 ||
      !process.stdin.isTTY || !process.stdout.isTTY) return blocked('owner_terminal_and_explicit_mode_required');
  const terminal = createInterface({input: process.stdin, output: process.stdout});
  try {
    const prepared = await prepareLiveCanary({owner: readSignedOwner(), apiKey: process.env.GEMINI_API_KEY}, {
      compareCredential: compareCredentialLocally,
      observeGoogle: () => collectGoogleObservations(p => terminal.question(p)),
    });
    if (prepared.status !== 'prepared' || mode === 'preflight') return prepared;
    if ((await terminal.question('This consumes the one compatibility attempt. Type EXECUTE ONE SYNTHETIC GEMINI CANARY: ')).trim() !== 'EXECUTE ONE SYNTHETIC GEMINI CANARY') return blocked('dispatch_not_confirmed');
    return await dispatchLiveCanary(prepared.handle);
  } finally { terminal.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await main())); }
  catch { console.log(JSON.stringify(blocked('runner_failed_closed'))); process.exitCode = 1; }
}
