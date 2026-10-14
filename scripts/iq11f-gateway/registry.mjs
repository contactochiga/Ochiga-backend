import {openai} from './adapters/openai.mjs';
import {anthropic} from './adapters/anthropic.mjs';
import {gemini} from './adapters/gemini.mjs';
// Explicit developer registrations only, not arbitrary URL/module selection.
export class AdapterRegistry {
  #entries = new Map();
  register(adapter) {
    if (!adapter || !/^[a-z][a-z0-9-]{1,39}$/.test(adapter.id) || adapter.mode !== 'offline_mock_only' || adapter.version !== 1 || typeof adapter.describe !== 'function' || typeof adapter.normalize !== 'function') throw Error('invalid_adapter_contract');
    if (this.#entries.has(adapter.id)) throw Error('duplicate_adapter');
    this.#entries.set(adapter.id, Object.freeze({...adapter}));
    return this;
  }
  get(id) { if (!this.#entries.has(id)) throw Error('unknown_adapter'); return this.#entries.get(id); }
  ids() { return [...this.#entries.keys()].sort(); }
}
export const defaultRegistry = () => new AdapterRegistry().register(openai).register(anthropic).register(gemini);
