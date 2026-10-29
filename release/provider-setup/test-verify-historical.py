#!/usr/bin/env python3
"""Negative tests for verify-historical.py. Read-only against the isolated environment: it copies the baseline files and
the run attribution files (state.json, scenario-orders.json, authorization-required.json; no secrets) into a scratch
directory, tampers with the copies, and runs the check with VERIFY_HISTORICAL_BASE / VERIFY_HISTORICAL_RUNTIME.
The reconciliation rules are additionally exercised against synthetic row counts (no database writes).
  HWTEST_SCRATCH=<dir> python3 test-verify-historical.py
"""
import importlib.util, json, os, shutil, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, 'verify-historical.py')
BASE = '/Users/ochigaidoko/getoyi-commerce/phase4/stage4f-cleanup'
RT = '/Users/ochigaidoko/getoyi-commerce/phase4/stage4e/environment-setup/runtime'
SCRATCH = os.path.join(os.environ['HWTEST_SCRATCH'], 'verify-historical-test')
results = []

def fixture(name):
    d = os.path.join(SCRATCH, name); shutil.rmtree(d, ignore_errors=True)
    b, r = os.path.join(d, 'base'), os.path.join(d, 'runtime')
    os.makedirs(b); os.makedirs(r, mode=0o700)
    for f in ('ledger-hashes-after.tsv', 'financial-counts-after.txt', 'hash-ledgers.sh'): shutil.copy(os.path.join(BASE, f), b)
    shutil.copy(os.path.join(RT, 'state.json'), r)
    for rid in os.listdir(os.path.join(RT, 'execution', 'runs')):
        src = os.path.join(RT, 'execution', 'runs', rid); dst = os.path.join(r, 'execution', 'runs', rid); os.makedirs(dst)
        for f in ('scenario-orders.json', 'authorization-required.json'):
            if os.path.exists(os.path.join(src, f)): shutil.copy(os.path.join(src, f), dst)
    return b, r

def run(b, r):
    p = subprocess.run([sys.executable, SCRIPT], capture_output=True, text=True, env={**os.environ, 'VERIFY_HISTORICAL_BASE': b, 'VERIFY_HISTORICAL_RUNTIME': r})
    return p.returncode, json.loads(p.stdout or p.stderr.strip().splitlines()[-1])

def case(name, expect, mutate):
    b, r = fixture(name); detail = mutate(b, r)
    rc, out = run(b, r)
    ok = bool(out['result'] == expect and (rc == 0) == (expect == 'PRESERVED') and (detail is None or detail(out)))
    results.append((name, ok, out['result'])); print(('PASS ' if ok else 'FAIL ') + name + ' -> ' + out['result'])

def edit(path, fn):
    t = open(path).read(); n = fn(t); assert n != t, 'tamper had no effect'; open(path, 'w').write(n)
def state(r, fn):
    p = os.path.join(r, 'state.json'); s = json.load(open(p)); fn(s); json.dump(s, open(p, 'w'))
def add_run(r, rid, order):
    d = os.path.join(r, 'execution', 'runs', rid); os.makedirs(d, exist_ok=True)
    json.dump({'single_payment': {'order_id': order, 'amount_kobo': 10000}}, open(os.path.join(d, 'scenario-orders.json'), 'w'))
    json.dump({'manifest_sha256': '0' * 64, 'plan_sha256': '0' * 64}, open(os.path.join(d, 'authorization-required.json'), 'w'))
    state(r, lambda s: s['single_payment_runs'].append({'run_id': rid, 'ledger_volume': 'hardware-execution-ledger-single-' + rid, 'provider_counter_volume': 'hardware-provider-counter-single-' + rid}))
problem = lambda code: (lambda out: any(p.get('problem') == code for p in out['attribution_problems']))

case('control_untampered', 'PRESERVED', lambda b, r: (lambda out: out['new_run_records'] and all(x['status'] == 'RECONCILED' for x in out['new_run_records'])))
case('ledger_hash_changed', 'DIFFERENCE', lambda b, r: edit(os.path.join(b, 'ledger-hashes-after.tsv'), lambda t: t.replace('\t', '\tX', 1)))
case('historical_row_count_changed', 'DIFFERENCE', lambda b, r: edit(os.path.join(b, 'financial-counts-after.txt'), lambda t: t.replace('public.hardware_payment_history 89', 'public.hardware_payment_history 88')))
case('original_attempt_fingerprint_changed', 'DIFFERENCE', lambda b, r: edit(os.path.join(b, 'financial-counts-after.txt'), lambda t: t.replace('1ea578726e6a1731964695628498f763', '0' * 32)))
case('baseline_counts_incomplete', 'FAILED', lambda b, r: edit(os.path.join(b, 'financial-counts-after.txt'), lambda t: t.replace('public.hardware_refunds 0\n', '')))
case('baseline_ledgers_truncated', 'FAILED', lambda b, r: edit(os.path.join(b, 'ledger-hashes-after.tsv'), lambda t: '\n'.join(t.splitlines()[:8]) + '\n'))
case('unattributed_run_volume', 'DIFFERENCE', lambda b, r: state(r, lambda s: s.update(single_payment_runs=[])) or (lambda out: out['historical_ledgers']['unattributed_volumes']))
# Exclusion abuse: a recorded "run" may never hide historical rows.
case('exclusion_of_pre_baseline_order', 'DIFFERENCE', lambda b, r: add_run(r, 'aaaaaaaaaaaa', 'dfc1f654-de35-435e-a130-5938af40fdfc') or problem('order_not_created_after_baseline'))
case('exclusion_of_original_reference', 'DIFFERENCE', lambda b, r: add_run(r, 'bbbbbbbbbbbb', 'c583de0a-0000-4000-8000-000000000000') or problem('reference_is_original_attempt'))
case('exclusion_of_nonexistent_order', 'DIFFERENCE', lambda b, r: add_run(r, 'cccccccccccc', '00000000-0000-4000-8000-000000000000') or problem('order_not_created_after_baseline'))
def unbound(b, r):
    state(r, lambda s: s['single_payment_runs'][0].update(provider_counter_volume='hardware-provider-counter-single-ffffffffffff')); return problem('volumes_not_bound_to_run')
case('run_volumes_not_bound', 'DIFFERENCE', unbound)
def shared(b, r):
    s = json.load(open(os.path.join(r, 'state.json'))); rid = s['single_payment_runs'][0]['run_id']
    order = json.load(open(os.path.join(r, 'execution', 'runs', rid, 'scenario-orders.json')))['single_payment']['order_id']
    add_run(r, 'dddddddddddd', order); return problem('order_shared_by_runs')
case('order_shared_by_two_runs', 'DIFFERENCE', shared)
def missing(b, r):
    rid = json.load(open(os.path.join(r, 'state.json')))['single_payment_runs'][0]['run_id']
    os.unlink(os.path.join(r, 'execution', 'runs', rid, 'scenario-orders.json')); return problem('run_files_missing')
case('run_files_missing', 'DIFFERENCE', missing)
case('invalid_run_id', 'DIFFERENCE', lambda b, r: state(r, lambda s: s['single_payment_runs'].append({'run_id': '../x'})) or problem('run_id_invalid'))

# Reconciliation rules against synthetic rows (module loaded with its database/counter readers replaced).
spec = importlib.util.spec_from_file_location('vh', SCRIPT); vh = importlib.util.module_from_spec(spec); spec.loader.exec_module(vh)
def recon(rows, states='', pay='not_started', dispatched=(0, 0, 0), counter=True, budget=None):
    base_rows = {t: 0 for t, c in {**vh.BACKEND, **vh.OFFICE}.items() if c is not None}; base_rows.update(rows)
    def q(container, sql):
        if 'string_agg(state' in sql: return states
        if 'select payment_state' in sql: return pay
        t = sql.split('public.')[1].split(' ')[0].rstrip(';'); return str(base_rows[t])
    vh.q = q
    vh.counter_of = lambda v: None if not counter else {'budget': budget or {'initialize': 1, 'read': 3, 'refund': 0}, 'dispatched': dict(zip(('initialize', 'read', 'refund'), dispatched)), 'records': sum(dispatched), 'open_dispatches': 0}
    return vh.reconcile({'run_id': 'eeeeeeeeeeee', 'order_id': '00000000-0000-4000-8000-000000000000', 'reference': 'hwo_' + '0' * 32, 'counter_volume': 'x'})
def rcase(name, expect_issue, **kw):
    out = recon(**kw)
    ok = (out['status'] == 'RECONCILED') if expect_issue is None else (expect_issue in out['issues'])
    results.append((name, ok, out['status'])); print(('PASS ' if ok else 'FAIL ') + name + ' -> ' + out['status'] + ' ' + ','.join(out['issues']))
paid = {'hardware_payment_attempts': 1, 'hardware_payment_events': 3, 'hardware_payment_observations': 1, 'hardware_payment_confirmations': 1, 'hardware_payment_delivery_queue': 2, 'hardware_payment_authorizations': 1, 'hardware_payment_delivery': 1, 'hardware_payment_history': 4}
rcase('recon_prepared_not_executed', None, rows={'hardware_payment_delivery': 1, 'hardware_payment_history': 1})
rcase('recon_paid_and_verified', None, rows=paid, states='confirmed', pay='paid', dispatched=(1, 2, 0))
rcase('recon_initialized_unpaid', None, rows={'hardware_payment_attempts': 1, 'hardware_payment_events': 1}, states='pending', dispatched=(1, 1, 0))
rcase('recon_refund_row', 'refund_records_present', rows={**paid, 'hardware_refunds': 1}, states='confirmed', pay='paid', dispatched=(1, 2, 0))
rcase('recon_refund_request', 'refund_records_present', rows={**paid, 'hardware_refund_requests': 1}, states='confirmed', pay='paid', dispatched=(1, 2, 0))
rcase('recon_payment_rows_without_initialize', 'payment_records_without_initialize', rows={'hardware_payment_events': 1})
rcase('recon_initialize_without_attempt', 'initialize_without_attempt_record', rows={}, dispatched=(1, 0, 0))
rcase('recon_over_budget', 'counter_over_budget', rows=paid, states='confirmed', pay='paid', dispatched=(1, 4, 0))
rcase('recon_wrong_budget', 'counter_budget_not_1_3_0', rows={}, budget={'initialize': 1, 'read': 3, 'refund': 1})
rcase('recon_two_attempts', 'more_than_one_attempt', rows={**paid, 'hardware_payment_attempts': 2}, states='confirmed,created', pay='paid', dispatched=(1, 2, 0))
rcase('recon_confirm_without_read', 'confirmation_without_verification_read', rows=paid, states='confirmed', pay='paid', dispatched=(1, 0, 0))
rcase('recon_paid_without_confirmation', 'paid_without_confirmation', rows={'hardware_payment_attempts': 1}, states='confirmed', pay='paid', dispatched=(1, 1, 0))
rcase('recon_confirmation_attempt_not_confirmed', 'confirmation_inconsistent_with_attempt_or_order', rows=paid, states='uncertain', pay='paid', dispatched=(1, 2, 0))
rcase('recon_counter_unavailable', 'counter_unavailable', rows={}, counter=False)

shutil.rmtree(SCRATCH, ignore_errors=True)
print(json.dumps({'passed': sum(ok for _, ok, _ in results), 'total': len(results)}))
sys.exit(0 if all(ok for _, ok, _ in results) else 1)
