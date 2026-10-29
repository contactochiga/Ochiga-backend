#!/usr/bin/env python3
"""Disposable end-to-end test of stage-run.py: startup, rollback, failure cases and timing.

Everything is named hwtest-* and removed afterwards: an internal private network, an egress bridge (used only for the
relay's startup DNS lookup of api.paystack.co to pin its firewall; no connection is opened because no ticket is ever
presented), synthetic "setup" Backend/Office/GetOyi containers, a synthetic Office reservation database, disposable run
ledgers/counters and a synthetic sk_test_ key. Test ledgers are armed with synthetic test-only authorizations. The real
hardware-setup-* environment is never addressed (stage-run.py refuses a test config that names it).
"""
import json, os, shutil, subprocess, sys, tempfile, time, uuid, hashlib, secrets
HERE = os.path.dirname(os.path.abspath(__file__)); X = os.path.join(HERE, '..', 'provider-execution')
REAL_SETUP = '/Users/ochigaidoko/getoyi-commerce/phase4/stage4e/environment-setup'
IMAGE = 'getoyi-bounded-execution:aca59b7-single-payment'; OFFICE_IMAGE = 'getoyi-phase4e-boundary:1033cdb-0c0bb0a'
ROOT = tempfile.mkdtemp(prefix='hwtest-stage-', dir=os.environ.get('HWTEST_SCRATCH') or None)
RT, SD = os.path.join(ROOT, 'runtime'), os.path.join(ROOT, 'setup')
CFG = {'runtime': RT, 'setup_dir': SD, 'private': 'hwtest-private', 'egress': 'hwtest-egress', 'backend': 'hwtest-setup-backend', 'office': 'hwtest-setup-office',
       'getoyi': 'hwtest-setup-getoyi', 'office_db': 'hwtest-office-db', 'probe': 'hwtest-probe', 'relay_prefix': 'hwtest-relay-',
       'ledger_prefix': 'hwtest-ledger-', 'counter_prefix': 'hwtest-counter-'}
results = []
def rec(i, ok, d=None): results.append({'id': i, 'ok': bool(ok), 'detail': d}); print(('PASS ' if ok else 'FAIL ') + i + ('' if d is None else ' ' + json.dumps(d)[:300]), flush=True)
def sh(*a, check=True, input=None):
    r = subprocess.run(list(a), capture_output=True, text=True, input=input)
    if check and r.returncode: raise RuntimeError(' '.join(a[:3]) + ' :: ' + r.stderr[-300:])
    return r
def stage(*a):
    t = time.time(); r = sh(sys.executable, os.path.join(HERE, 'stage-run.py'), *a, check=False) if False else subprocess.run([sys.executable, os.path.join(HERE, 'stage-run.py'), *a], capture_output=True, text=True, env={**os.environ, 'STAGE_RUN_TEST_CONFIG': os.path.join(ROOT, 'cfg.json')})
    try: out = json.loads(r.stdout)
    except Exception: out = {'raw': r.stdout[-300:], 'err': r.stderr[-300:]}
    return r.returncode, out, round(time.time() - t, 2)
def inspect(n):
    r = sh('docker', 'inspect', n, check=False); return json.loads(r.stdout)[0] if r.returncode == 0 else None
def env_of(n): return dict(e.split('=', 1) for e in inspect(n)['Config']['Env'])
def psql(q): return sh('docker', 'exec', '-i', CFG['office_db'], 'psql', '-X', '-Atq', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', input=q).stdout.strip()

def setup_stack():
    os.makedirs(os.path.join(RT, 'tls'), mode=0o700); os.makedirs(os.path.join(RT, 'execution', 'runs'), mode=0o700); os.makedirs(SD); os.makedirs(os.path.join(RT, 'fixture-storage'))
    shutil.copy(os.path.join(REAL_SETUP, 'runtime', 'tls', 'cert.pem'), os.path.join(RT, 'tls', 'cert.pem'))  # public certificate only
    for g in ('guard.cjs', 'guard-bounded-office.cjs'): shutil.copy(os.path.join(REAL_SETUP, g), os.path.join(SD, g))
    key = os.path.join(RT, 'provider-test-key'); fd = os.open(key, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600); os.write(fd, ('sk_test_SYNTHETICHWTEST' + secrets.token_hex(16) + '\n').encode()); os.close(fd)
    real = json.load(open(os.path.join(HERE, '..', '..', 'release', 'provider-setup', 'stage-run.py').replace('stage-run.py', 'stage-run.py'))) if False else None
    cfg = {**CFG, 'image': IMAGE, 'image_id': sh('docker', 'image', 'inspect', IMAGE, '--format', '{{.Id}}').stdout.strip()}
    json.dump(cfg, open(os.path.join(ROOT, 'cfg.json'), 'w'))
    sh('docker', 'network', 'create', '--internal', '--label', 'getoyi.hwtest=true', CFG['private'])
    sh('docker', 'network', 'create', '--label', 'getoyi.hwtest=true', CFG['egress'])
    sh('docker', 'run', '-d', '--name', CFG['office_db'], '--label', 'getoyi.hwtest=true', '--network', 'none', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:16-alpine')
    for _ in range(60):
        if sh('docker', 'exec', CFG['office_db'], 'pg_isready', '-U', 'postgres', check=False).returncode == 0: break
        time.sleep(0.5)
    time.sleep(1)
    psql("create table hardware_orders(id uuid primary key,payment_state text,payable_total_kobo bigint);create table hardware_reservations(order_id uuid,state text,expires_at timestamptz);")
    syn = lambda n: 'hwtest-synthetic-' + n + '-' + secrets.token_hex(12)
    benv = {'HARDWARE_SETUP_ONLY': 'true', 'SUPABASE_URL': 'http://backend-rest:3000', 'SUPABASE_SERVICE_ROLE_KEY': syn('sr'), 'HARDWARE_TEST_CALLBACK_ORIGIN': 'https://localhost:18443',
            'HARDWARE_PAYSTACK_CALLBACK_URL': 'https://localhost:18443/hardware/checkout', 'HARDWARE_PAYSTACK_SECRET_KEY': 'sk_test_SETUP_hwtest', 'HARDWARE_TEST_WEBHOOK_KEY_FILE': '/run/secrets/hardware-test-key',
            'OFFICE_HARDWARE_PAYMENT_CONFIRM_URL': 'https://office.hardware.test/api/commerce/payments/confirm', 'OFFICE_HARDWARE_FINANCIAL_URL': 'https://office.hardware.test/api/commerce/payments/operations',
            'OFFICE_HARDWARE_PAYMENT_CONFIRM_KEY': syn('confirm'), 'OFFICE_HARDWARE_FINANCIAL_KEY': syn('financial'), 'HARDWARE_OFFICE_API_KEY': syn('office'), 'NODE_ENV': 'test', 'NODE_EXTRA_CA_CERTS': '/tls/cert.pem',
            'HARDWARE_PAYMENT_INITIALIZATION_ENABLED': 'false', 'HARDWARE_PAYMENT_PROCESSING_ENABLED': 'false', 'HARDWARE_FINANCIAL_RECOVERY_ENABLED': 'false', 'HARDWARE_REFUNDS_ENABLED': 'false'}
    run_c(CFG['backend'], IMAGE, benv, [RT + '/tls/cert.pem:/tls/cert.pem:ro', key + ':/run/secrets/hardware-test-key:ro'], ['node', '-e', 'setInterval(()=>{},1e6)'], '/app/backend', [CFG['backend']])
    oenv = {'ISOLATED_SERVICE': 'office', 'OPENAI_API_KEY': 'sk-SETUP-NOT-A-CREDENTIAL', 'OPENAI_BASE_URL': 'http://127.0.0.1:9/v1', 'SUPABASE_URL': 'http://office-data:3000', 'SUPABASE_SERVICE_ROLE_KEY': syn('osr'),
            'OFFICE_APP_URL': 'https://localhost:18445', 'LEAD_AGENTS_SCOPED_API_KEYS': '[]', 'LEAD_AGENTS_API_KEYS': syn('api'), 'LEAD_AGENTS_SESSION_SECRET': syn('session'), 'LEAD_AGENTS_AUTH_MODE': 'required_api_key',
            'LEAD_AGENTS_HOST': '0.0.0.0', 'LEAD_AGENTS_PORT': '8787', 'LEAD_AGENTS_STORE_DRIVER': 'supabase', 'NODE_ENV': 'test', 'NODE_EXTRA_CA_CERTS': '/tls/cert.pem',
            'HARDWARE_PAYMENT_BACKEND_URL': 'https://office.hardware.test/backend', 'HARDWARE_PAYMENT_BACKEND_KEY': syn('pbk'), 'OFFICE_HARDWARE_PAYMENTS_ENABLED': 'false', 'OFFICE_HARDWARE_PAYMENT_PROCESSING_ENABLED': 'false',
            'OFFICE_HARDWARE_FINANCIAL_ENABLED': 'true', 'OFFICE_HARDWARE_CHECKOUT_ENABLED': 'true', 'OFFICE_HARDWARE_ORDERS_ENABLED': 'true', 'OFFICE_HARDWARE_RESERVATIONS_ENABLED': 'true'}
    run_c(CFG['office'], OFFICE_IMAGE, oenv, [SD + '/guard.cjs:/guard.cjs:ro', RT + '/fixture-storage:/fixture-storage', RT + '/tls/cert.pem:/tls/cert.pem:ro'], ['node', '--require', '/guard.cjs', 'lead-agents-server.js'], '/app/office', [])
    run_c(CFG['getoyi'], IMAGE, {'HARDWARE_CATALOGUE_ENABLED': 'false', 'HARDWARE_CHECKOUT_ENABLED': 'false', 'HARDWARE_PAYMENTS_ENABLED': 'false'}, [], ['node', '-e', 'setInterval(()=>{},1e6)'], '/app/backend', [])
    time.sleep(3)
    return key

def run_c(name, image, env, binds, cmd, wd, aliases):
    a = ['docker', 'run', '-d', '--name', name, '--label', 'getoyi.hwtest=true', '--label', 'getoyi.isolated.setup=true', '--network', CFG['private'], '--restart', 'no', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '-w', wd]
    for al in aliases: a += ['--network-alias', al]
    for b in binds: a += ['-v', b]
    for k, v in env.items(): a += ['-e', k + '=' + v]
    sh(*(a + [image] + cmd))

def new_run(hold_seconds=900, state='held'):
    run_id = secrets.token_hex(6); order = str(uuid.uuid4()); ref = 'hwo_' + order.replace('-', '')
    d = os.path.join(RT, 'execution', 'runs', run_id); os.makedirs(d, mode=0o700)
    manifest = {**json.load(open(os.path.join(X, 'single-payment-manifest.json'))), 'customer_email': 'acceptance-inbox@payments-test.getoyi.com'}
    py = ("import sys,json;sys.path.insert(0,sys.argv[1]);from executor import Executor;from bridge import main;m=json.loads(sys.argv[3]);e=Executor(sys.argv[2],m);dg=e.digest;e.close();"
          "print(json.dumps({'digest':dg,'plan':main({'database':sys.argv[2],'manifest':m,'mode':'real-provider','action':'prepare','plan':[{'reference':sys.argv[4],'scenario':'single_payment','amount':10000}]})['plan_sha256']}))")
    o = json.loads(sh(sys.executable, '-c', py, X, os.path.join(d, 'run.sqlite'), json.dumps(manifest), ref).stdout)
    json.dump({'database': '/run/execution/run.sqlite', 'manifest': manifest, 'mode': 'real-provider', 'planSha256': o['plan'], 'python': 'python3'}, open(os.path.join(d, 'config.json'), 'w'))
    json.dump({'manifest_sha256': o['digest'], 'plan_sha256': o['plan'], 'authorized': False, 'environment': 'test', 'evidence': 'real-provider'}, open(os.path.join(d, 'authorization-required.json'), 'w'))
    json.dump({'single_payment': {'order_id': order, 'guest_hash': 'a' * 64, 'idempotency_key': 'hwtest', 'amount_kobo': 10000, 'quantity': 1, 'evidence': 'hwtest-synthetic'}}, open(os.path.join(d, 'scenario-orders.json'), 'w'))
    for f in os.listdir(d): os.chmod(os.path.join(d, f), 0o600)
    cdir = os.path.join(ROOT, 'counter-seed-' + run_id)
    sh('node', os.path.join(X, 'provider-counter.cjs'), '--prepare', cdir, o['plan'], input=json.dumps(manifest))
    copy = "import shutil,os;shutil.copytree('/seed','/run/x',dirs_exist_ok=True);[(os.chown(p,1000,1000),os.chmod(p,0o700 if os.path.isdir(p) else 0o600)) for p in ['/run/x']+[os.path.join(dd,n) for dd,ds,fs in os.walk('/run/x') for n in ds+fs]]"
    for vol, seed in ((CFG['ledger_prefix'] + run_id, d), (CFG['counter_prefix'] + run_id, cdir)):
        sh('docker', 'volume', 'create', '--label', 'getoyi.hwtest=true', vol)
        sh('docker', 'run', '--rm', '--network', 'none', '-v', seed + ':/seed:ro', '-v', vol + ':/run/x', '--entrypoint', 'python3', IMAGE, '-c', copy)
    psql(f"insert into hardware_orders values('{order}','not_started',10000);insert into hardware_reservations values('{order}','{state}',clock_timestamp()+interval '{hold_seconds} seconds');")
    return {'id': run_id, 'dir': d, 'digest': o['digest'], 'plan': o['plan'], 'order': order}

def owner_auth(r, **over):
    # Synthetic, test-only stand-in for the owner's authorization file (the real one is created by the owner).
    a = {'manifest_sha256': r['digest'], 'plan_sha256': r['plan'], 'authorized': True, 'environment': 'test', 'evidence': 'real-provider', **over}
    p = os.path.join(r['dir'], 'authorization.json')
    if os.path.exists(p): os.unlink(p)
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600); os.write(fd, (json.dumps(a) + '\n').encode()); os.close(fd)
def arm(r):
    return sh('docker', 'run', '--rm', '--network', 'none', '--user', '1000:1000', '-v', CFG['ledger_prefix'] + r['id'] + ':/run/execution', '--entrypoint', 'python3', IMAGE, 'release/provider-execution/control.py', '--arm-approved-run', check=False).returncode == 0
def window_end(minutes=50): return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + minutes * 60))
def ledger_status(r):
    q = {'database': '/run/execution/run.sqlite', 'manifest': json.load(open(os.path.join(r['dir'], 'config.json')))['manifest'], 'mode': 'real-provider', 'plan_sha256': r['plan'], 'action': 'status'}
    o = sh('docker', 'run', '--rm', '--network', 'none', '--user', '1000:1000', '-v', CFG['ledger_prefix'] + r['id'] + ':/run/execution', '--entrypoint', 'python3', IMAGE, '-c',
           "import sys,json;sys.path.insert(0,'release/provider-execution');from bridge import main;print(json.dumps(main(json.loads(sys.argv[1]))))", json.dumps(q)).stdout
    return json.loads(o.strip().splitlines()[-1])
def setup_state():
    return {n: (inspect(n) or {}).get('Config', {}).get('Labels', {}).get('getoyi.run') for n in (CFG['backend'], CFG['office'])}

def cleanup():
    names = sh('docker', 'ps', '-aq', '--filter', 'label=getoyi.hwtest=true').stdout.split() + sh('docker', 'ps', '-aq', '--filter', 'name=hwtest-').stdout.split()
    if names: sh('docker', 'rm', '-f', *set(names), check=False)
    for v in sh('docker', 'volume', 'ls', '-q', '--filter', 'label=getoyi.hwtest=true').stdout.split(): sh('docker', 'volume', 'rm', '-f', v, check=False)
    for n in (CFG['private'], CFG['egress']): sh('docker', 'network', 'rm', n, check=False)
    shutil.rmtree(ROOT, ignore_errors=True)

def main():
    cleanup_first = [n for n in sh('docker', 'ps', '-aq', '--filter', 'name=hwtest-').stdout.split()]
    if cleanup_first: sh('docker', 'rm', '-f', *cleanup_first, check=False)
    for n in (CFG['private'], CFG['egress']): sh('docker', 'network', 'rm', n, check=False)
    try:
        setup_stack()
        before = {n: env_of(n) for n in (CFG['backend'], CFG['office'])}
        # 0. The script refuses a test config that names real resources.
        bad = json.load(open(os.path.join(ROOT, 'cfg.json'))); bad['backend'] = 'hardware-setup-backend'; json.dump(bad, open(os.path.join(ROOT, 'bad.json'), 'w'))
        r0 = subprocess.run([sys.executable, os.path.join(HERE, 'stage-run.py'), 'check', 'aaaaaaaaaaaa'], capture_output=True, text=True, env={**os.environ, 'STAGE_RUN_TEST_CONFIG': os.path.join(ROOT, 'bad.json')})
        rec('T0-TEST-CONFIG-GUARD', 'test_config_must_be_disposable' in r0.stdout)
        # 1. Fresh run: check passes; install refuses without/with wrong authorization; installs the owner file exactly.
        A = new_run(900)
        rc, o, s = stage('check', A['id']); rec('T1-CHECK', rc == 0 and o['hold_seconds'] >= 660 and o['counter']['records'] == 0 and o['ledger']['intent_count'] == 0, {'s': s, 'hold': o.get('hold_seconds')})
        rc, o, _ = stage('install', A['id']); rec('T2-INSTALL-NO-AUTH', rc == 1 and o['code'] == 'authorization_file_missing_or_unsafe')
        owner_auth(A, plan_sha256='0' * 64); rc, o, _ = stage('install', A['id']); rec('T2-INSTALL-WRONG-PLAN', rc == 1 and o['code'] == 'authorization_does_not_match_run')
        owner_auth(A, authorized=False); rc, o, _ = stage('install', A['id']); rec('T2-INSTALL-NOT-AUTHORIZED', rc == 1 and o['code'] == 'authorization_does_not_match_run')
        owner_auth(A); h = hashlib.sha256(open(os.path.join(A['dir'], 'authorization.json'), 'rb').read()).hexdigest()
        rc, o, _ = stage('install', A['id']); rec('T2-INSTALL-EXACT', rc == 0 and o['authorization_sha256'] == h and o['armed'] is False and not ledger_status(A)['run_enabled'])
        rc, o, _ = stage('install', A['id']); rec('T2-INSTALL-ONCE', rc == 1)
        # 3. start refuses before arming; nothing changes.
        rc, o, _ = stage('start', A['id'], '--window-end', window_end()); rec('T3-START-UNARMED', rc == 1 and o['code'] == 'run_not_armed_or_not_fresh' and setup_state() == {CFG['backend']: None, CFG['office']: None} and not inspect(CFG['relay_prefix'] + A['id']))
        rc, o, _ = stage('start', A['id'], '--window-end', '2020-01-01T00:00:00Z'); rec('T3-START-WINDOW-CLOSED', rc == 1 and o['code'] == 'window_closed_or_too_long')
        # 4. Success path (owner-authorized arming simulated with the synthetic test authorization), timed.
        rec('T4-ARM-TEST-LEDGER', arm(A))
        rc, o, s = stage('start', A['id'], '--window-end', window_end())
        rec('T4-START-READY', rc == 0 and o.get('ready') and o['relay_counter'] == {'initialize': 0, 'refund': 0, 'read': 0} and o['hold_seconds'] >= 600, {'elapsed_s': s, 'steps': o.get('steps'), 'code': o.get('code'), 'raw': o.get('raw')})
        if rc == 0:
            be, oe = env_of(CFG['backend']), env_of(CFG['office'])
            rec('T4-BACKEND-PROFILE', be['HARDWARE_EXECUTION_PROFILE'] == 'single-payment-acceptance' and be['HARDWARE_FINANCIAL_RECOVERY_ENABLED'] == 'false' and be['HARDWARE_REFUNDS_ENABLED'] == 'false' and inspect(CFG['backend'])['HostConfig']['ReadonlyRootfs'])
            rec('T4-OFFICE-SWITCHES', all(oe[k] == 'true' for k in ('OFFICE_HARDWARE_PAYMENTS_ENABLED', 'OFFICE_HARDWARE_PAYMENT_PROCESSING_ENABLED', 'OFFICE_HARDWARE_FINANCIAL_ENABLED')) and oe['HARDWARE_TEST_MANIFEST_SHA256'] == A['digest'])
            fw = sh('docker', 'exec', CFG['relay_prefix'] + A['id'], 'iptables', '-L', 'OUTPUT', '-v', '-x', '-n').stdout
            rec('T4-RELAY-EGRESS-ONLY', 'policy DROP' in fw and all(l.split()[0] == '0' for l in fw.splitlines() if 'getoyi-provider-new' in l), {'provider_new_lines': [l.split()[:2] for l in fw.splitlines() if 'getoyi-provider-new' in l][:4]})
            rec('T4-SETUP-BACKUPS-KEPT', inspect(CFG['backend'] + '-before-run-' + A['id']) is not None and inspect(CFG['office'] + '-before-run-' + A['id']) is not None)
            rec('T4-NO-PROVIDER-REQUEST', ledger_status(A)['provider_dispatch_count'] == 0)
        # 5. Close-down restores the exact setup configuration.
        rc, o, s = stage('stop', A['id'])
        rec('T5-STOP-RESTORES', rc == 0 and o['setup_restored'] and not o['ledger']['run_enabled'] and setup_state() == {CFG['backend']: None, CFG['office']: None}, {'elapsed_s': s})
        rec('T5-SETUP-CONFIG-IDENTICAL', {n: env_of(n) for n in before} == before)
        rec('T5-RELAY-STOPPED-DETACHED', not inspect(CFG['relay_prefix'] + A['id'])['State']['Running'] and not inspect(CFG['relay_prefix'] + A['id'])['NetworkSettings']['Networks'])
        rec('T5-RELAY-FINAL-COUNTER-ZERO', (o.get('relay_final') or {}).get('counter', {}).get('dispatched') == {'initialize': 0, 'refund': 0, 'read': 0})
        # 6. Short hold and expired reservation: refused before any change.
        B = new_run(630); owner_auth(B); stage('install', B['id']); arm(B)
        rc, o, _ = stage('start', B['id'], '--window-end', window_end()); rec('T6-SHORT-HOLD-REFUSED', rc == 1 and o['code'] == 'reservation_hold_insufficient' and setup_state() == {CFG['backend']: None, CFG['office']: None} and not inspect(CFG['relay_prefix'] + B['id']))
        C = new_run(900, state='expired'); owner_auth(C); stage('install', C['id']); arm(C)
        rc, o, _ = stage('start', C['id'], '--window-end', window_end()); rec('T6-EXPIRED-RESERVATION-REFUSED', rc == 1 and o['code'] == 'reservation_hold_insufficient')
        rc, o, _ = stage('check', C['id']); rec('T6-EXPIRED-HOLD-IS-ZERO', o.get('hold_seconds') == 0 and o.get('ready_for_start_after_arming') is False)
        # 7. Bounded Office refuses to start (guard denies): automatic rollback restores setup and disables the run.
        D = new_run(900); owner_auth(D); stage('install', D['id']); arm(D)
        good_guard = open(os.path.join(SD, 'guard-bounded-office.cjs')).read(); open(os.path.join(SD, 'guard-bounded-office.cjs'), 'w').write("console.error('isolated_service_startup_denied');process.exit(1);\n")
        rc, o, s = stage('start', D['id'], '--window-end', window_end())
        open(os.path.join(SD, 'guard-bounded-office.cjs'), 'w').write(good_guard)
        rec('T7-OFFICE-FAIL-ROLLBACK', rc == 1 and o['code'] == 'bounded_office_start_failed:rolled_back' and setup_state() == {CFG['backend']: None, CFG['office']: None} and inspect(CFG['backend'])['State']['Running'] and inspect(CFG['office'])['State']['Running'], {'elapsed_s': s, 'code': o.get('code')})
        rec('T7-RUN-DISABLED', not ledger_status(D)['run_enabled'] and ledger_status(D)['provider_dispatch_count'] == 0)
        rec('T7-RELAY-STOPPED', not inspect(CFG['relay_prefix'] + D['id'])['State']['Running'] and not inspect(CFG['relay_prefix'] + D['id'])['NetworkSettings']['Networks'])
        rec('T7-FAILED-KEPT-FOR-EVIDENCE', any(n.startswith(CFG['office'] + '-failed-' + D['id']) for n in sh('docker', 'ps', '-a', '--format', '{{.Names}}').stdout.split()))
        rec('T7-SETUP-CONFIG-IDENTICAL', {n: env_of(n) for n in before} == before)
        # 8. Relay refuses to start (counter volume tampered): rollback before any service swap.
        E = new_run(900); owner_auth(E); stage('install', E['id']); arm(E)
        sh('docker', 'run', '--rm', '--network', 'none', '--user', '1000:1000', '-v', CFG['counter_prefix'] + E['id'] + ':/c', '--entrypoint', 'sh', IMAGE, '-c', "printf 'tampered\\n' >> /c/requests.jsonl")
        rc, o, _ = stage('start', E['id'], '--window-end', window_end())
        rec('T8-COUNTER-TAMPER-REFUSED', rc == 1 and o['code'] in ('counter_not_fresh', 'counter_unavailable', 'relay_start_failed:rolled_back') and setup_state() == {CFG['backend']: None, CFG['office']: None}, {'code': o.get('code')})
        # 9. Public checkout enabled: refused at check.
        F = new_run(900)
        sh('docker', 'rm', '-f', CFG['getoyi']); run_c(CFG['getoyi'], IMAGE, {'HARDWARE_CATALOGUE_ENABLED': 'false', 'HARDWARE_CHECKOUT_ENABLED': 'true', 'HARDWARE_PAYMENTS_ENABLED': 'false'}, [], ['node', '-e', 'setInterval(()=>{},1e6)'], '/app/backend', [])
        rc, o, _ = stage('check', F['id']); rec('T9-PUBLIC-CHECKOUT-REFUSED', rc == 1 and o['code'] == 'public_checkout_not_disabled')
    finally:
        # Diagnostics: last log lines of any service the staging script rolled back (secrets are never logged by these services).
        for n in sh('docker', 'ps', '-a', '--format', '{{.Names}}').stdout.split():
            if n.startswith('hwtest-') and '-failed-' in n:
                print('LOG', n, json.dumps(sh('docker', 'logs', '--tail', '6', n, check=False).stderr[-600:] + sh('docker', 'logs', '--tail', '6', n, check=False).stdout[-300:]))
        cleanup()
    failed = [r for r in results if not r['ok']]
    print(json.dumps({'stage_run_tests': len(results), 'failed': len(failed)}))
    return 1 if failed else 0

if __name__ == '__main__': sys.exit(main())
