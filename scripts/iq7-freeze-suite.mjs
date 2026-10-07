// Builds the frozen artifact for a held-out batch. Split: alternating within each (surface, stratum) group, fixed by order, recorded in the artifact.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const batch = process.argv[2] || 'A';
const m = await import(`./iq7-heldout-suite-${batch}.mjs`);
const seen = {}; const items = m.ITEMS.map((it, i) => {const g = `${it.s}|${it.st}`; seen[g] = (seen[g] || 0) + 1; return {id: `IQ7${batch}-${String(i + 1).padStart(3, '0')}`, split: batch === 'A' ? (seen[g] % 2 === 1 ? 'dev' : 'test') : 'blind', ...it};});
const tally = f => items.reduce((a, x) => (a[f(x)] = (a[f(x)] || 0) + 1, a), {});
const out = {version: 1, batch, status: `IQ7_HELDOUT_${batch}_FROZEN_PRE_IMPLEMENTATION`, note: 'Frozen before implementation. Runtime must never read this file (static guard). Expectations describe understanding, not response text.',
  composition: {items: items.length, by_surface: tally(x => x.s), by_stratum: tally(x => x.st), by_split: tally(x => x.split), by_expected_objective: tally(x => String(x.o)), by_fact_class: tally(x => x.f || '-'), by_action: tally(x => x.act || '-'), e2e_items: items.filter(x => x.e2e).length, with_context: items.filter(x => x.c !== 'o_none' && !/_none$/.test(x.c)).length},
  contexts: m.CONTEXTS, items};
const path = `artifacts/intelligence-quality-v1-iq7-heldout-suite-${batch}.json`; fs.writeFileSync(path, JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({path, sha256: createHash('sha256').update(fs.readFileSync(path)).digest('hex'), composition: out.composition}, null, 1));
