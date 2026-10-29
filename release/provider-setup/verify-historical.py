#!/usr/bin/env python3
"""Read-only preservation check that stays meaningful after authorized new runs.

verify-after-approval.sh compares the whole environment with the Phase 4F baseline, so any authorized preparation or run
(a new ledger volume, a delivery fixture, a payment attempt) makes it report DIFFERENCE. It is kept as a diagnostic.
This check compares only history and attributes everything new:
- the 9 baseline ledger volumes must be byte-identical; any extra ledger volume must belong to a run recorded in
  runtime/state.json (single_payment_runs / single_init_runs);
- exclusions apply ONLY to explicitly recorded single-payment runs, and each excluded identifier is itself verified:
  well-formed run id with its own run directory and ledger volume, order created after the baseline capture, distinct,
  and never the original uncertain attempt's reference;
- every financial table, counted EXCLUDING rows for those orders/references (delivery-queue rows via their event's
  reference), must equal the baseline count; tables with no order/reference link must be exactly unchanged;
- the original uncertain attempt's row fingerprint must equal the baseline (it is never touched);
- every recorded run's own records are reconciled separately against its durable provider counter (new_run_records);
- office_wallets row count unchanged; switches off.
Read-only transactions and read-only volume mounts; no credential is printed.
VERIFY_HISTORICAL_BASE / VERIFY_HISTORICAL_RUNTIME override the baseline and runtime directories (negative tests only).
"""
import json, os, re, subprocess, sys
BASE = os.environ.get('VERIFY_HISTORICAL_BASE', '/Users/ochigaidoko/getoyi-commerce/phase4/stage4f-cleanup')
RT = os.environ.get('VERIFY_HISTORICAL_RUNTIME', '/Users/ochigaidoko/getoyi-commerce/phase4/stage4e/environment-setup/runtime')
IMAGE = 'getoyi-bounded-execution:aca59b7-single-payment'
BASELINE_CAPTURED = '2026-10-28 05:48:01+00'  # financial-counts-after.txt; an excluded order must be newer than this
ORIGINAL_REF_PREFIX = 'hwo_c583de0a'
QUEUE = ('hardware_payment_delivery_queue', 'event_id')  # linked to a reference through hardware_payment_events
BACKEND = {'hardware_payment_attempts': 'reference', 'hardware_payment_delivery_queue': QUEUE, 'hardware_payment_events': 'reference', 'hardware_payment_inbox': 'reference',
           'hardware_payment_observations': 'reference', 'hardware_refund_events': None, 'hardware_refunds': 'reference'}
OFFICE = {'hardware_payment_authorizations': 'order_id', 'hardware_payment_confirmations': 'order_id', 'hardware_payment_delivery': 'order_id', 'hardware_payment_history': 'order_id',
          'hardware_refund_decisions': None, 'hardware_refund_requests': 'order_id', 'office_wallets': None}

def sh(*a, input=None):
    r = subprocess.run(list(a), capture_output=True, text=True, input=input)
    if r.returncode: raise SystemExit(json.dumps({'result': 'FAILED', 'step': a[1] if len(a) > 1 else a[0]}))
    return r.stdout
def q(container, sql): return sh('docker', 'exec', '-i', container, 'psql', '-X', '-q', '-At', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', input='begin transaction read only;\n' + sql + '\nrollback;\n').strip()
inlist = lambda vals: '(' + ','.join("'" + v + "'" for v in vals) + ')' if vals else "('')"

def where_not(col, vals):
    if col is None: return ''
    if col == QUEUE: return f" where event_id not in (select id from public.hardware_payment_events where reference in {inlist(vals)})"
    return f" where {col}::text not in {inlist(vals)}"
def where_in(col, vals):
    if col == QUEUE: return f" where event_id in (select id from public.hardware_payment_events where reference in {inlist(vals)})"
    return f" where {col}::text in {inlist(vals)}"

def attributed_runs(state):
    """The only identifiers ever excluded. Any run that fails these checks is reported and fails the whole check."""
    runs, problems = [], []
    for r in state.get('single_payment_runs', []):
        rid = r.get('run_id', '')
        try:
            if not re.fullmatch(r'[0-9a-f]{12}', rid): raise ValueError('run_id_invalid')
            if r.get('ledger_volume') != 'hardware-execution-ledger-single-' + rid or r.get('provider_counter_volume') != 'hardware-provider-counter-single-' + rid: raise ValueError('volumes_not_bound_to_run')
            d = os.path.join(RT, 'execution', 'runs', rid)
            o = json.load(open(os.path.join(d, 'scenario-orders.json')))['single_payment']['order_id']
            if not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', o): raise ValueError('order_id_invalid')
            json.load(open(os.path.join(d, 'authorization-required.json')))
            runs.append({'run_id': rid, 'order_id': o, 'reference': 'hwo_' + o.replace('-', ''), 'counter_volume': r['provider_counter_volume']})
        except (OSError, KeyError, ValueError) as e:
            problems.append({'run_id': rid[:12] if isinstance(rid, str) else '?', 'problem': str(e) if isinstance(e, ValueError) else 'run_files_missing'})
    if len({r['order_id'] for r in runs}) != len(runs): problems.append({'problem': 'order_shared_by_runs'})
    for r in runs:
        if r['reference'].startswith(ORIGINAL_REF_PREFIX): problems.append({'run_id': r['run_id'], 'problem': 'reference_is_original_attempt'}); continue
        created = q('hardware-setup-office-db', f"select count(*) from public.hardware_orders where id = '{r['order_id']}'::uuid and created_at > '{BASELINE_CAPTURED}'::timestamptz;")
        if created != '1': problems.append({'run_id': r['run_id'], 'problem': 'order_not_created_after_baseline'})
    return runs, problems

def counter_of(volume):
    r = subprocess.run(['docker', 'run', '--rm', '--network', 'none', '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                        '-v', volume + ':/run/provider-counter:ro', '--entrypoint', 'node', IMAGE, 'release/provider-execution/provider-counter.cjs', '--inspect', '/run/provider-counter'],
                       capture_output=True, text=True)
    return json.loads(r.stdout) if r.returncode == 0 else None

def reconcile(run):
    """A run's own records must be explained by its own provider counter (refund budget 0)."""
    rows = {}
    for container, spec, key in (('hardware-setup-backend-db', BACKEND, run['reference']), ('hardware-setup-office-db', OFFICE, run['order_id'])):
        for t, col in spec.items():
            if col is not None: rows[t] = int(q(container, f'select count(*) from public.{t}{where_in(col, [key])};'))
    att = q('hardware-setup-backend-db', f"select coalesce(string_agg(state, ','), '') from public.hardware_payment_attempts where reference = '{run['reference']}';")
    pay = q('hardware-setup-office-db', f"select payment_state from public.hardware_orders where id = '{run['order_id']}'::uuid;")
    cnt = counter_of(run['counter_volume'])
    out = {'run_id': run['run_id'], 'reference': run['reference'][:12] + '…', 'rows': rows, 'attempt_states': att.split(',') if att else [], 'office_payment_state': pay}
    issues = []
    if cnt is None: issues.append('counter_unavailable'); dispatched = None
    else:
        dispatched = cnt['dispatched']; out['counter'] = {'dispatched': dispatched, 'records': cnt['records'], 'open_dispatches': cnt['open_dispatches']}
        if cnt['budget'] != {'initialize': 1, 'read': 3, 'refund': 0}: issues.append('counter_budget_not_1_3_0')
        if dispatched['initialize'] > 1 or dispatched['read'] > 3 or dispatched['refund'] != 0: issues.append('counter_over_budget')
    if rows['hardware_refunds'] or rows['hardware_refund_requests']: issues.append('refund_records_present')
    if rows['hardware_payment_attempts'] > 1: issues.append('more_than_one_attempt')
    if dispatched is not None:
        if dispatched['initialize'] > rows['hardware_payment_attempts']: issues.append('initialize_without_attempt_record')
        if dispatched['initialize'] == 0 and (rows['hardware_payment_events'] or rows['hardware_payment_observations'] or rows['hardware_payment_confirmations'] or rows['hardware_payment_delivery_queue']):
            issues.append('payment_records_without_initialize')
        if rows['hardware_payment_confirmations'] and dispatched['read'] == 0: issues.append('confirmation_without_verification_read')
    if rows['hardware_payment_confirmations'] > 1: issues.append('more_than_one_confirmation')
    if rows['hardware_payment_confirmations'] and (out['attempt_states'] != ['confirmed'] or pay != 'paid'): issues.append('confirmation_inconsistent_with_attempt_or_order')
    if pay == 'paid' and not rows['hardware_payment_confirmations']: issues.append('paid_without_confirmation')
    out['issues'] = issues
    out['status'] = 'RECONCILED' if not issues else 'UNRECONCILED'
    return out

def main():
    out, ok = {}, True
    state = json.load(open(os.path.join(RT, 'state.json')))
    runs, problems = attributed_runs(state)
    known = {r['run_id'] for r in runs} | {r['run_id'] for r in state.get('single_init_runs', [])}
    orders, refs = [r['order_id'] for r in runs], [r['reference'] for r in runs]
    out['new_runs_attributed'] = [r['run_id'] for r in runs]
    out['attribution_problems'] = problems
    ok &= not problems
    # Ledgers.
    base = {l.split('\t', 1)[0]: l for l in open(os.path.join(BASE, 'ledger-hashes-after.tsv')).read().splitlines() if l.strip()}
    now = {l.split('\t', 1)[0]: l for l in sh('sh', os.path.join(BASE, 'hash-ledgers.sh')).splitlines() if l.strip()}
    changed = [v for v in base if now.get(v) != base[v]]
    extra = [v for v in now if v not in base]
    unattributed = [v for v in extra if not any(v == 'hardware-execution-ledger-single-' + r for r in known)]
    if len(base) != 9: raise SystemExit(json.dumps({'result': 'FAILED', 'step': 'baseline_ledgers_not_9'}))
    out['historical_ledgers'] = {'baseline': len(base), 'identical': len(base) - len(changed), 'changed': changed, 'new_run_volumes': extra, 'unattributed_volumes': unattributed}
    ok &= not changed and not unattributed
    # Financial rows.
    b = {}
    for l in open(os.path.join(BASE, 'financial-counts-after.txt')).read().splitlines():
        p = l.split(' ')
        if p[0].startswith('public.'): b[p[0][7:]] = int(p[1])
        elif p[0] == 'attempt': b['__attempt__'] = l
    if not all(t in b for t in list(BACKEND) + list(OFFICE) + ['__attempt__']): raise SystemExit(json.dumps({'result': 'FAILED', 'step': 'baseline_counts_incomplete'}))
    tables = {}
    for container, spec, excl in (('hardware-setup-backend-db', BACKEND, refs), ('hardware-setup-office-db', OFFICE, orders)):
        for t, col in spec.items():
            n = int(q(container, f'select count(*) from public.{t}{where_not(col, excl)};'))
            tables[t] = {'historical_rows': n, 'baseline': b[t], 'unchanged': n == b[t]}
            ok &= n == b[t]
    out['financial_tables'] = tables
    # The original uncertain attempt, exactly as fingerprinted at baseline.
    line = q('hardware-setup-backend-db', "select 'attempt', left(reference,12), state, environment, attempts, lease_token is not null, created_at, updated_at, md5(a::text) from public.hardware_payment_attempts a where reference not in " + inlist(refs) + ';').replace('|', ' ')
    out['original_attempt_unchanged'] = line == b['__attempt__']
    ok &= out['original_attempt_unchanged']
    # New-run records, reconciled separately (never silently excluded).
    out['new_run_records'] = [reconcile(r) for r in runs]
    ok &= all(r['status'] == 'RECONCILED' for r in out['new_run_records'])
    # Switches.
    sw = sh('sh', '-c', "for c in hardware-setup-office hardware-setup-backend hardware-setup-getoyi; do docker inspect $c -f '{{range .Config.Env}}{{println .}}{{end}}' | grep -E '(PAYMENT|REFUND|RECOVERY|CATALOGUE|CHECKOUT)[A-Z_]*_ENABLED=' | sed \"s|^|$c |\"; done")
    bad = [l for l in sw.splitlines() if re.search(r'(PAYMENT|REFUND|RECOVERY)[A-Z_]*_ENABLED=true', l) or (l.startswith('hardware-setup-getoyi') and l.endswith('=true'))]
    out['switches_off'] = not bad; ok &= not bad
    out['result'] = 'PRESERVED' if ok else 'DIFFERENCE'
    print(json.dumps(out, indent=1))
    return 0 if ok else 1

if __name__ == '__main__': sys.exit(main())
