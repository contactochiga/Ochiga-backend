#!/usr/bin/env python3
"""Negative tests for verify-historical.py. Read-only against the isolated environment: it copies the baseline files and
the run attribution files (state.json, scenario-orders.json, authorization-required.json; no secrets) into a scratch
directory, tampers with the copies, and runs the check with VERIFY_HISTORICAL_BASE / VERIFY_HISTORICAL_RUNTIME.
The reconciliation rules are additionally exercised against synthetic row counts, and the attribution/digest SQL against a
disposable hwtest-vh-bdb database loaded with the real Backend financial schema (schema only; no real database writes).
  HWTEST_SCRATCH=<dir> python3 test-verify-historical.py
"""
import hashlib, importlib.util, json, os, shutil, subprocess, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, 'verify-historical.py')
BASE = '/Users/ochigaidoko/getoyi-commerce/phase4/stage4f-cleanup'
RT = '/Users/ochigaidoko/getoyi-commerce/phase4/stage4e/environment-setup/runtime'
DIGESTS = '/Users/ochigaidoko/getoyi-commerce/phase4/stage4p-closure/historical-digests.json'
SCRATCH = os.path.join(os.environ['HWTEST_SCRATCH'], 'verify-historical-test')
results = []

def fixture(name):
    d = os.path.join(SCRATCH, name); shutil.rmtree(d, ignore_errors=True)
    b, r = os.path.join(d, 'base'), os.path.join(d, 'runtime')
    os.makedirs(b); os.makedirs(r, mode=0o700)
    for f in ('ledger-hashes-after.tsv', 'financial-counts-after.txt'): shutil.copy(os.path.join(BASE, f), b)
    shutil.copyfile(DIGESTS, os.path.join(b, 'digests.json'))
    shutil.copy(os.path.join(RT, 'state.json'), r)
    for rid in os.listdir(os.path.join(RT, 'execution', 'runs')):
        src = os.path.join(RT, 'execution', 'runs', rid); dst = os.path.join(r, 'execution', 'runs', rid); os.makedirs(dst)
        for f in ('scenario-orders.json', 'authorization-required.json'):
            if os.path.exists(os.path.join(src, f)): shutil.copy(os.path.join(src, f), dst)
    return b, r

def run(b, r):
    p = subprocess.run([sys.executable, SCRIPT], capture_output=True, text=True, env={**os.environ, 'VERIFY_HISTORICAL_BASE': b, 'VERIFY_HISTORICAL_RUNTIME': r, 'VERIFY_HISTORICAL_DIGESTS': os.path.join(b, 'digests.json')})
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
    plan = hashlib.sha256(json.dumps([{'reference': 'hwo_' + order.replace('-', ''), 'scenario': 'single_payment', 'amount': 10000}], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    json.dump({'manifest_sha256': '0' * 64, 'plan_sha256': plan}, open(os.path.join(d, 'authorization-required.json'), 'w'))
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
def rebind(b, r):
    rid = json.load(open(os.path.join(r, 'state.json')))['single_payment_runs'][0]['run_id']
    edit(os.path.join(r, 'execution', 'runs', rid, 'scenario-orders.json'), lambda t: t.replace(json.loads(t)['single_payment']['order_id'], 'dfc1f654-de35-435e-a130-5938af40fdfc'))
    return problem('order_not_bound_to_plan')
case('run_order_rebound_to_other_order', 'DIFFERENCE', rebind)
def digest_changed(b, r):
    edit(os.path.join(b, 'digests.json'), lambda t: t.replace(json.loads(t)['digests']['hardware_payment_history'], '0' * 32))
    return lambda out: out['historical_digests']['changed'] == ['hardware_payment_history']
case('historical_content_digest_changed', 'DIFFERENCE', digest_changed)
case('digest_baseline_missing', 'DIFFERENCE', lambda b, r: os.unlink(os.path.join(b, 'digests.json')) or (lambda out: out['historical_digests'] == {'baseline': 'missing'}))
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
rcase('recon_two_authorizations', 'more_than_one_authorization', rows={'hardware_payment_authorizations': 2})
rcase('recon_inbox_without_initialize', 'payment_records_without_initialize', rows={'hardware_payment_inbox': 1})
rcase('recon_counter_unavailable', 'counter_unavailable', rows={}, counter=False)

# The attribution SQL itself, on a disposable database loaded with the real Backend financial schema (schema only, read
# from the real database with pg_dump -s; its trigger functions are not copied, so rows can be edited here to simulate
# tampering). Review finding 3: delivery-queue rows belong to observations, whose ids overlap with event ids.
DB = 'hwtest-vh-bdb'
def dsh(*a, input=None): return subprocess.run(list(a), capture_output=True, text=True, input=input)
dsh('docker', 'rm', '-f', DB)
try:
    dsh('docker', 'run', '-d', '--name', DB, '--label', 'getoyi.hwtest=true', '--network', 'none', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:16-alpine')
    for _ in range(60):
        if dsh('docker', 'exec', DB, 'pg_isready', '-U', 'postgres').returncode == 0: break
        time.sleep(0.5)
    time.sleep(1)
    ddl = dsh('docker', 'exec', 'hardware-setup-backend-db', 'pg_dump', '-U', 'postgres', '-s', '--no-owner', '--no-privileges', *sum((['-t', 'public.' + t] for t in vh.BACKEND), [])).stdout
    dsh('docker', 'exec', '-i', DB, 'psql', '-X', '-q', '-U', 'postgres', input=ddl)
    H, R = 'hwo_' + 'a' * 32, 'hwo_' + 'b' * 32
    att = lambda ref: f"insert into hardware_payment_attempts(reference,order_id,reservation_id,amount_kobo,currency,environment,authorization_hash) values('{ref}',gen_random_uuid(),gen_random_uuid(),10000,'NGN','test','{'c' * 64}');"
    seed = (att(H) + att(R) + "".join(f"insert into hardware_payment_events(reference,event_type) values('{H}','h{i}');" for i in range(7)) +
            f"insert into hardware_payment_events(reference,event_type) values('{R}','r1'),('{R}','r2');" +
            f"insert into hardware_payment_observations(reference,state,evidence,fingerprint) values('{H}','provider_pending','{{}}','fh'),('{R}','provider_success','{{}}','fr');" +
            "insert into hardware_payment_delivery_queue(event_id) values(1),(2);")
    r = dsh('docker', 'exec', '-i', DB, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', input=seed)
    vh.BDB = DB; vh.q = vh.__dict__['q'] if False else (lambda c, sql: dsh('docker', 'exec', '-i', c, 'psql', '-X', '-q', '-At', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', input='begin read only;' + sql + 'rollback;').stdout.strip())
    cnt = lambda w: int(vh.q(DB, 'select count(*) from public.hardware_payment_delivery_queue' + w + ';'))
    hist, mine = cnt(vh.where_not(vh.QUEUE, [R])), cnt(vh.where_in(vh.QUEUE, [R]))
    ok = r.returncode == 0 and hist == 1 and mine == 1
    results.append(('real_schema_queue_attribution', ok, (hist, mine))); print(('PASS ' if ok else 'FAIL ') + 'real_schema_queue_attribution historical=%d run=%d (event-id join would give 2/0)' % (hist, mine))
    dg = lambda: vh.q(DB, "select md5(coalesce(string_agg(x::text, E'\\n' order by x::text), '')) from public.hardware_payment_delivery_queue x" + vh.where_not(vh.QUEUE, [R]) + ';')
    d0 = dg(); dsh('docker', 'exec', '-i', DB, 'psql', '-X', '-q', '-U', 'postgres', input="update hardware_payment_delivery_queue set delivered_at=now() where event_id=1;")
    ok = d0 != dg() and cnt(vh.where_not(vh.QUEUE, [R])) == 1
    results.append(('real_schema_in_place_edit_detected_by_digest', ok, None)); print(('PASS ' if ok else 'FAIL ') + 'real_schema_in_place_edit_detected_by_digest (count unchanged, digest changed)')
finally:
    dsh('docker', 'rm', '-f', DB)

shutil.rmtree(SCRATCH, ignore_errors=True)
print(json.dumps({'passed': sum(ok for _, ok, _ in results), 'total': len(results)}))
sys.exit(0 if all(ok for _, ok, _ in results) else 1)
