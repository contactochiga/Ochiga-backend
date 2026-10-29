#!/usr/bin/env python3
"""Read-only preservation check that stays meaningful after authorized new runs.

verify-after-approval.sh compares the whole environment with the Phase 4F baseline, so any authorized preparation or run
(a new ledger volume, a delivery fixture, a payment attempt) makes it report DIFFERENCE. This check compares only
history and attributes everything new:
- the 9 baseline ledger volumes must be byte-identical; any extra ledger volume must belong to a run recorded in
  runtime/state.json (single_payment_runs / single_init_runs);
- every financial table, counted EXCLUDING rows for orders/references of recorded single-payment runs, must equal the
  baseline count; tables without an order/reference column must be exactly unchanged;
- the original uncertain attempt's row fingerprint must equal the baseline (it is never touched);
- office_wallets row count unchanged.
Read-only transactions; no credential is printed.
"""
import json, os, re, subprocess, sys
BASE = '/Users/ochigaidoko/getoyi-commerce/phase4/stage4f-cleanup'
RT = '/Users/ochigaidoko/getoyi-commerce/phase4/stage4e/environment-setup/runtime'
BACKEND = {'hardware_payment_attempts': 'reference', 'hardware_payment_delivery_queue': None, 'hardware_payment_events': 'reference', 'hardware_payment_inbox': 'reference',
           'hardware_payment_observations': 'reference', 'hardware_refund_events': None, 'hardware_refunds': 'reference'}
OFFICE = {'hardware_payment_authorizations': 'order_id', 'hardware_payment_confirmations': 'order_id', 'hardware_payment_delivery': 'order_id', 'hardware_payment_history': 'order_id',
          'hardware_refund_decisions': None, 'hardware_refund_requests': 'order_id', 'office_wallets': None}

def sh(*a, input=None):
    r = subprocess.run(list(a), capture_output=True, text=True, input=input)
    if r.returncode: raise SystemExit(json.dumps({'result': 'FAILED', 'step': a[1] if len(a) > 1 else a[0]}))
    return r.stdout
def q(container, sql): return sh('docker', 'exec', '-i', container, 'psql', '-X', '-q', '-At', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', input='begin transaction read only;\n' + sql + '\nrollback;\n').strip()

def main():
    out, ok = {}, True
    state = json.load(open(os.path.join(RT, 'state.json')))
    runs = [r['run_id'] for r in state.get('single_payment_runs', [])]
    known = set(runs) | {r['run_id'] for r in state.get('single_init_runs', [])}
    orders, refs = [], []
    for rid in runs:
        o = json.load(open(os.path.join(RT, 'execution', 'runs', rid, 'scenario-orders.json')))['single_payment']['order_id']
        assert re.fullmatch(r'[0-9a-f-]{36}', o); orders.append(o); refs.append('hwo_' + o.replace('-', ''))
    out['new_runs_attributed'] = runs
    # Ledgers.
    base = {l.split('\t', 1)[0]: l for l in open(os.path.join(BASE, 'ledger-hashes-after.tsv')).read().splitlines() if l.strip()}
    now = {l.split('\t', 1)[0]: l for l in sh('sh', os.path.join(BASE, 'hash-ledgers.sh')).splitlines() if l.strip()}
    changed = [v for v in base if now.get(v) != base[v]]
    extra = [v for v in now if v not in base]
    unattributed = [v for v in extra if not any(v == 'hardware-execution-ledger-single-' + r for r in known)]
    out['historical_ledgers'] = {'baseline': len(base), 'identical': len(base) - len(changed), 'changed': changed, 'new_run_volumes': extra, 'unattributed_volumes': unattributed}
    ok &= not changed and not unattributed
    # Financial rows.
    b = {}
    for l in open(os.path.join(BASE, 'financial-counts-after.txt')).read().splitlines():
        p = l.split(' ')
        if p[0].startswith('public.'): b[p[0][7:]] = int(p[1])
        elif p[0] == 'attempt': b['__attempt__'] = l
    inlist = lambda vals: '(' + ','.join("'" + v + "'" for v in vals) + ')' if vals else "('')"
    tables = {}
    for container, spec, excl in (('hardware-setup-backend-db', BACKEND, refs), ('hardware-setup-office-db', OFFICE, orders)):
        for t, col in spec.items():
            where = '' if col is None else f" where {col}::text not in {inlist(excl)}"
            n = int(q(container, f'select count(*) from public.{t}{where};'))
            tables[t] = {'historical_rows': n, 'baseline': b[t], 'unchanged': n == b[t]}
            ok &= n == b[t]
    out['financial_tables'] = tables
    # The original uncertain attempt, exactly as fingerprinted at baseline.
    line = q('hardware-setup-backend-db', "select 'attempt', left(reference,12), state, environment, attempts, lease_token is not null, created_at, updated_at, md5(a::text) from public.hardware_payment_attempts a where reference not in " + inlist(refs) + ';').replace('|', ' ')
    out['original_attempt_unchanged'] = line == b['__attempt__']
    ok &= out['original_attempt_unchanged']
    # Switches.
    sw = sh('sh', '-c', "for c in hardware-setup-office hardware-setup-backend hardware-setup-getoyi; do docker inspect $c -f '{{range .Config.Env}}{{println .}}{{end}}' | grep -E '(PAYMENT|REFUND|RECOVERY|CATALOGUE|CHECKOUT)[A-Z_]*_ENABLED=' | sed \"s|^|$c |\"; done")
    bad = [l for l in sw.splitlines() if re.search(r'(PAYMENT|REFUND|RECOVERY)[A-Z_]*_ENABLED=true', l) or (l.startswith('hardware-setup-getoyi') and l.endswith('=true'))]
    out['switches_off'] = not bad; ok &= not bad
    out['result'] = 'PRESERVED' if ok else 'DIFFERENCE'
    print(json.dumps(out, indent=1))
    return 0 if ok else 1

if __name__ == '__main__': sys.exit(main())
