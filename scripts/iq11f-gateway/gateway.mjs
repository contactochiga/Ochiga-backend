// Offline policy/state-machine model only. It consumes inert recorded mock replies.
// No transport callback, environment lookup, SDK, database or runtime adoption hook.
import {hash, checkPacket, validateCandidate} from '../iq11e/contract.mjs';
import {defaultRegistry} from './registry.mjs';

const transient = new Set(['unavailable', 'rate_limited', 'transport_error', 'timeout']);
const keyOf = r => `${r.provider}/${r.model}`;
const int = n => Number.isSafeInteger(n) && n >= 0;
const clone = x => structuredClone(x);
const freeze = x => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };

export class OfflineGateway {
  #registry; #profiles; #replies; #transfers; #memo = new Map(); #circuits = new Map();
  #spent = 0; #held = 0; #accountingBlocked = false; #cap; #limits; #deadline; #overall;
  constructor({registry = defaultRegistry(), profiles = [], replies = [], transfers = [], mockBudgetMicroUsd = 0, limits = {input: 4096, output: 1024}, perAttemptMs = 3000, overallMs = 3000} = {}) {
    if (!int(mockBudgetMicroUsd) || !int(limits.input) || !limits.input || limits.input > 4096 || !int(limits.output) || !limits.output || limits.output > 1024 || !int(perAttemptMs) || !perAttemptMs || perAttemptMs > 3000 || !int(overallMs) || overallMs < perAttemptMs || overallMs > 3000) throw Error('invalid_offline_limits');
    this.#registry = registry; this.#profiles = clone(profiles); this.#replies = clone(replies); this.#transfers = clone(transfers);
    this.#cap = mockBudgetMicroUsd; this.#limits = clone(limits); this.#deadline = perAttemptMs; this.#overall = overallMs;
  }
  setMockProfiles(profiles) { this.#profiles = clone(profiles); }
  accounting() { return {mock_spent_micro_usd: this.#spent, mock_held_micro_usd: this.#held, mock_cap_micro_usd: this.#cap, actual_provider_spend: 0}; }
  #profile(r, p) {
    const profile = this.#profiles.find(a => a.provider === r.provider && a.model === r.model);
    if (!profile || profile.mode !== 'offline_mock_only' || !profile.policy_id || !profile.tokenizer_id || !(Date.parse(profile.expires_at) > Date.parse(p.now)) || !profile.surfaces?.includes(p.surface) || !profile.scope_tokens?.includes(p.scope_token) || profile.data_class !== 'synthetic') return null;
    return profile;
  }
  run({packet, baseline, route = [], locks = {}, inputTokens = {}}, nowMs = 0) {
    // Reject before even hashing/logging an invalid/private packet.
    if (!int(nowMs) || checkPacket(packet).length) return freeze({state: 'invalid_packet', adopted: false, records: []});
    const baselineHash = hash(baseline), packetHash = hash(packet), records = [];
    const finish = (state, shadow = null) => {
      if (hash(baseline) !== baselineHash) throw Error('baseline_mutation');
      return freeze({state, request_id: packet.request_id, packet_hash: packetHash, context_epoch: packet.context_epoch, baseline_hash: baselineHash, adopted: false, canonical_decision_changed: false, shadow_candidate: shadow, records: clone(records), accounting: this.accounting()});
    };
    if (!Array.isArray(route) || route.length > 2 || route.some(r => !r || typeof r.provider !== 'string' || typeof r.model !== 'string') || new Set(route.map(keyOf)).size !== route.length) return finish('invalid_route');
    if (!route.length) return finish('provider_off_baseline');
    // Revalidate current policy before a duplicate can receive a cached shadow result.
    if (route.some(r => !this.#profile(r, packet))) return finish('recipient_not_approved');
    const fingerprint = hash({packet, baselineHash, route, locks, inputTokens, policies: route.map(r => this.#profile(r, packet)), transfers: this.#transfers});
    if (this.#memo.has(packet.request_id)) {
      const prior = this.#memo.get(packet.request_id);
      if (prior.fingerprint !== fingerprint) return finish('conflicting_retry');
      return freeze({...clone(prior.result), duplicate_delivery: true});
    }
    if (this.#accountingBlocked) return finish('accounting_reconciliation_required');
    let elapsed = 0, finalState = 'provider_off_baseline', shadow = null;
    for (const [index, routeEntry] of route.entries()) {
      const profile = this.#profile(routeEntry, packet), routeKey = keyOf(routeEntry);
      // An approved provider is NOT an approved transfer destination for this packet.
      if (index && !this.#transfers.some(t => t.mode === 'offline_mock_only' && t.from === keyOf(route[index - 1]) && t.to === routeKey && t.packet_hash === packetHash && t.surface === packet.surface && t.scope_token === packet.scope_token && t.policy_id === profile.policy_id)) { finalState = 'transfer_not_approved'; break; }
      if (elapsed >= this.#overall) { finalState = 'overall_timeout'; break; }
      let adapter;
      try { adapter = this.#registry.get(routeEntry.provider); } catch { finalState = 'unknown_adapter'; break; }
      const circuitKey = `${routeKey}/${profile.policy_id}/${packet.scope_token}`;
      const circuit = this.#circuits.get(circuitKey) ?? {failures: 0, openUntil: 0};
      if (circuit.failures >= 3 && nowMs + elapsed < circuit.openUntil) { finalState = 'circuit_open'; break; }
      // Virtual half-open probe after cooldown; one sequential attempt in this simulator.
      const input = inputTokens[routeKey];
      if (!int(input) || input === 0 || input > this.#limits.input) { finalState = 'token_limit_or_unknown'; break; }
      const price = profile.price;
      if (!price || !price.version || !int(price.input_upper_micro_per_token) || !int(price.output_upper_micro_per_token) || !price.input_upper_micro_per_token || !price.output_upper_micro_per_token) { finalState = 'price_unknown'; break; }
      const reserve = input * price.input_upper_micro_per_token + this.#limits.output * price.output_upper_micro_per_token;
      if (!int(reserve) || this.#spent + this.#held + reserve > this.#cap) { finalState = 'budget_blocked'; break; }
      // Clone so a trusted adapter cannot accidentally mutate canonical inputs.
      try {
        const description = adapter.describe(clone(packet), routeEntry.model, clone(this.#limits));
        if (description.sendable !== false || description.mode !== 'offline_mock_only' || description.provider !== routeEntry.provider || description.model !== routeEntry.model) throw Error('live_transport_prohibited');
      } catch { finalState = 'adapter_description_error'; break; }
      this.#held += reserve;
      const record = {attempt: index + 1, provider: routeEntry.provider, model: routeEntry.model, policy_id: profile.policy_id, request_id: packet.request_id, packet_hash: packetHash, context_epoch: packet.context_epoch, reserve_micro_usd: reserve, elapsed_ms: 0, state: 'pending', validation_error_count: 0};
      records.push(record);
      const available = this.#replies.filter(r => r.provider === routeEntry.provider && r.model === routeEntry.model && r.request_id === packet.request_id);
      let normalized = null, provenNotAccepted = false;
      if (available.length !== 1) record.state = available.length ? 'conflicting_receipts' : 'missing_receipt';
      else {
        const reply = available[0], remaining = Math.min(this.#deadline, this.#overall - elapsed);
        if (reply.input_hash !== packetHash || reply.context_epoch !== packet.context_epoch || !int(reply.elapsed_ms)) record.state = 'correlation_mismatch';
        else if (reply.elapsed_ms > remaining) { record.state = 'timeout'; record.elapsed_ms = remaining; }
        else {
          record.elapsed_ms = reply.elapsed_ms;
          if (['unavailable', 'rate_limited', 'transport_error', 'timeout'].includes(reply.transport_status)) {
            record.state = reply.transport_status;
            provenNotAccepted = reply.billing_status === 'not_accepted' && ['unavailable', 'rate_limited'].includes(reply.transport_status);
          }
          else if (reply.transport_status !== 'ok') record.state = 'invalid_receipt';
          else {
            try { normalized = adapter.normalize(clone(reply.body), routeEntry.model); }
            catch { normalized = {status: 'invalid_response', candidate: null, usage: null}; }
            if (!normalized || !['candidate', 'refused', 'incomplete', 'invalid_response', 'unexpected_output'].includes(normalized.status)) normalized = {status: 'invalid_response', candidate: null, usage: null};
            record.state = normalized.status;
            if (record.state === 'candidate') {
              const validation = validateCandidate(normalized.candidate, packet, locks);
              record.validation_error_count = validation.errors.length;
              record.state = validation.valid ? 'valid_shadow' : 'invalid_candidate';
              if (validation.valid) shadow = clone(normalized.candidate);
            }
          }
        }
      }
      elapsed += record.elapsed_ms;
      const usage = normalized?.usage;
      if (usage && int(usage.input_total) && int(usage.output_total) && usage.input_total <= input && usage.output_total <= this.#limits.output) {
        const conservativeCost = usage.input_total * price.input_upper_micro_per_token + usage.output_total * price.output_upper_micro_per_token;
        this.#held -= reserve; this.#spent += conservativeCost;
        record.accounting = 'settled_mock_upper_bound';
        record.usage = Object.fromEntries(['input_total', 'output_total', 'cached_input', 'cache_write', 'reasoning_output'].map(k => [k, int(usage[k]) ? usage[k] : null]));
        record.cost_upper_micro_usd = conservativeCost;
      } else if (provenNotAccepted) {
        this.#held -= reserve;
        record.accounting = 'mock_proven_not_accepted'; record.cost_upper_micro_usd = 0;
      } else {
        record.accounting = 'uncertain_reservation_retained';
        this.#accountingBlocked = true;
        // Missing/over-limit usage never becomes zero or billable success.
        if (record.state === 'valid_shadow') { record.state = 'accounting_uncertain'; shadow = null; }
      }
      if (record.state === 'valid_shadow') this.#circuits.set(circuitKey, {failures: 0, openUntil: 0});
      else if (transient.has(record.state) || ['invalid_response', 'invalid_candidate'].includes(record.state)) {
        this.#circuits.set(circuitKey, {failures: circuit.failures + 1, openUntil: nowMs + elapsed + 30000});
      }
      finalState = record.state;
      // Never shop for a provider that will bypass a refusal, invalid candidate or denial.
      if (!transient.has(record.state) || this.#accountingBlocked) break;
    }
    const result = finish(finalState, shadow);
    this.#memo.set(packet.request_id, {fingerprint, result});
    return result;
  }
}
