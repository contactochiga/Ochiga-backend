// Explicitly selects the development corpus; never opens the sealed independent corpus.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
assert.equal(process.env.SUPABASE_URL, 'http://127.0.0.1:55421');
const corpus = 'artifacts/intelligence-quality-v1-iq9a-dev-runner.json';
assert.equal(JSON.parse(fs.readFileSync(corpus, 'utf8')).items.length, 160);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iq9a14-development-'));
const out = `${process.env.WAVE11_HARNESS_OUT}.json`;
assert(!fs.existsSync(out), 'Refusing to overwrite a run');
process.env.IQ8F_CONFIG = path.join(dir, 'config.json');
fs.writeFileSync(process.env.IQ8F_CONFIG, JSON.stringify({corpus, out}));
await import('./iq8f-run.mjs');
