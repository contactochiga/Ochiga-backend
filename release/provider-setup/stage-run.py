#!/usr/bin/env python3
"""Fail-closed runtime staging for ONE prepared single-payment run (local isolated environment only).

Automates only the container startup/swap and configuration checks that sit between the owner's authorization and
`run.cjs initialize`. It never creates or edits owner authorization, never arms or initializes, never sends a provider
request, and refuses to touch any run whose reservation hold is too short.

  stage-run.py check   <run_id>                 read-only readiness report (no changes)
  stage-run.py install <run_id>                 copy the OWNER-CREATED runtime/.../runs/<run>/authorization.json,
                                                byte-identical and validated, into the run's ledger volume (no arming)
  [owner-authorized, separate]  control.py --arm-approved-run   (see the procedure; this script never arms)
  stage-run.py start   <run_id> --window-end <ISO-8601 UTC>
                                                requires an ARMED run, >= 660 s of hold, and the window still open; starts the
                                                relay and swaps in the bounded Backend and Office; verifies everything; rolls back
                                                automatically on any failure (and disables the run ledger)
  stage-run.py stop    <run_id>                 close-down: disable the ledger, stop the relay and bounded services, restore the
                                                setup containers, verify switches are off

Configuration is the real isolated environment. STAGE_RUN_TEST_CONFIG=<json> substitutes disposable resources for tests;
it is refused unless every container, network and volume name starts with 'hwtest-' and the run root is not the real one.
"""
import calendar, hashlib, json, os, re, subprocess, sys, tempfile, time

REAL = {
 'runtime': '/Users/ochigaidoko/getoyi-commerce/phase4/stage4e/environment-setup/runtime',
 'setup_dir': '/Users/ochigaidoko/getoyi-commerce/phase4/stage4e/environment-setup',
 'image': 'getoyi-bounded-execution:aca59b7-single-payment',
 'image_id': 'sha256:ab5d2eda7f0ec1583512212eb49140136cc8430afd5b97e90cd20d6f30f2235a',
 'private': 'hardware-setup-private', 'egress': 'hardware-provider-egress-nat',
 'backend': 'hardware-setup-backend', 'office': 'hardware-setup-office', 'getoyi': 'hardware-setup-getoyi',
 'office_db': 'hardware-setup-office-db', 'probe': 'hardware-provider-egress',
 'relay_prefix': 'hardware-provider-financial-', 'ledger_prefix': 'hardware-execution-ledger-single-',
 'counter_prefix': 'hardware-provider-counter-single-', 'key_fingerprint': '1f80490e69b859ed',
 'quote_url': 'https://localhost:18445/api/commerce/checkout/payment-quote', 'test': False,
}
MANIFEST_KEYS = {'execution_profile': 'single-payment-acceptance', 'max_payment_initializations': 1, 'max_payment_kobo': 10000,
                 'max_total_payment_kobo': 10000, 'max_refund_initializations': 0, 'max_refund_kobo': 0, 'max_provider_reads': 3,
                 'max_webhook_replays': 0, 'environment': 'test', 'currency': 'NGN'}
HOLD_START_S, HOLD_INIT_S = 660, 600
# Setup and bounded services keep no state in the container; a Node PID 1 ignores SIGTERM, so a long grace only adds
# dead time to the reservation hold. The relay keeps 10 s so its SIGTERM counter summary is logged.
STOP_S = 3  # start needs a margin over run.cjs's own 600 s initialize floor
SAFE_ERR = re.compile(r'^[a-z0-9_:.-]{1,80}$')

class Refused(RuntimeError): pass
def require(cond, code):
    if not cond: raise Refused(code)

def config():
    p = os.environ.get('STAGE_RUN_TEST_CONFIG')
    if not p: return dict(REAL)
    c = {**REAL, **json.load(open(p)), 'test': True}
    names = [c[k] for k in ('private', 'egress', 'backend', 'office', 'getoyi', 'office_db', 'probe', 'relay_prefix', 'ledger_prefix', 'counter_prefix')]
    require(all(n.startswith('hwtest-') for n in names) and os.path.realpath(c['runtime']) != os.path.realpath(REAL['runtime']), 'test_config_must_be_disposable')
    return c

def sh(*a, check=True, input=None, timeout=120):
    r = subprocess.run(list(a), capture_output=True, text=True, input=input, timeout=timeout)
    if check and r.returncode: raise Refused('command_failed:' + (a[1] if len(a) > 1 else a[0]))
    return r
def inspect(name):
    r = sh('docker', 'inspect', name, check=False)
    return json.loads(r.stdout)[0] if r.returncode == 0 else None
def env_of(c): return dict(e.split('=', 1) for e in c['Config']['Env'])
def sha256_file(p): return hashlib.sha256(open(p, 'rb').read()).hexdigest()
def canonical(v): return json.dumps(v, sort_keys=True, separators=(',', ':'))

class Run:
    def __init__(self, c, run_id):
        require(re.fullmatch(r'[a-f0-9]{12}', run_id or ''), 'invalid_run_id')
        self.c, self.id = c, run_id
        self.dir = os.path.join(c['runtime'], 'execution', 'runs', run_id)
        self.ledger, self.counter = c['ledger_prefix'] + run_id, c['counter_prefix'] + run_id
        self.relay = c['relay_prefix'] + run_id
        require(os.path.isdir(self.dir), 'run_directory_missing')
        self.config = json.load(open(os.path.join(self.dir, 'config.json')))
        self.required = json.load(open(os.path.join(self.dir, 'authorization-required.json')))
        self.orders = json.load(open(os.path.join(self.dir, 'scenario-orders.json')))
    def container(self, *cmd, user='1000:1000', network='none', extra=()):
        return sh('docker', 'run', '--rm', '--network', network, '--user', user, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                  '-v', self.ledger + ':/run/execution', *extra, '--entrypoint', cmd[0], self.c['image'], *cmd[1:], check=False)
    def bridge(self, action):
        q = {'database': '/run/execution/run.sqlite', 'manifest': self.config['manifest'], 'mode': 'real-provider', 'plan_sha256': self.config['planSha256'], 'action': action}
        r = self.container('python3', '-c', "import sys,json;sys.path.insert(0,'release/provider-execution');from bridge import main;print(json.dumps(main(json.loads(sys.argv[1]))))", json.dumps(q))
        require(r.returncode == 0, 'ledger_status_unavailable')
        return json.loads(r.stdout.strip().splitlines()[-1])

def hold_seconds(run):
    order = run.orders['single_payment']['order_id']
    require(re.fullmatch(r'[0-9a-f-]{36}', order), 'invalid_order')
    q = ("begin read only; select r.state||'|'||floor(extract(epoch from (r.expires_at-clock_timestamp())))::text||'|'||o.payment_state||'|'||o.payable_total_kobo "
         "from hardware_reservations r join hardware_orders o on o.id=r.order_id where o.id='" + order + "'::uuid; rollback;")
    r = sh('docker', 'exec', '-i', run.c['office_db'], 'psql', '-X', '-Atq', '-U', 'postgres', '-d', 'postgres', input=q, check=False)
    rows = [l for l in r.stdout.splitlines() if '|' in l]
    require(r.returncode == 0 and len(rows) == 1, 'reservation_status_unavailable')
    state, secs, pay, payable = rows[0].split('|')
    # Not held, or not exactly NGN 100 unpaid: no time counts. An expired hold can never be staged or paid against.
    return max(0, int(secs)) if (state, pay, payable) == ('held', 'not_started', '10000') else 0

def validate_authorization(run, path):
    require(os.path.isfile(path) and not os.path.islink(path) and (os.stat(path).st_mode & 0o077) == 0, 'authorization_file_missing_or_unsafe')
    raw = open(path, 'rb').read()
    try: a = json.loads(raw)
    except Exception: raise Refused('authorization_not_json')
    expected = {'manifest_sha256': run.required['manifest_sha256'], 'plan_sha256': run.required['plan_sha256'], 'authorized': True, 'environment': 'test', 'evidence': 'real-provider'}
    require(a == expected, 'authorization_does_not_match_run')
    return hashlib.sha256(raw).hexdigest()

def check(c, run_id, quiet=False):
    """Read-only. Returns a report; raises Refused on the first failed gate."""
    run, rep, t0 = Run(c, run_id), {}, time.time()
    m = run.config['manifest']
    require(run.config.get('mode') == 'real-provider' and run.config.get('database') == '/run/execution/run.sqlite', 'run_config_invalid')
    require(all(m.get(k) == v for k, v in MANIFEST_KEYS.items()), 'manifest_budget_not_single_payment')
    require(hashlib.sha256(canonical(m).encode()).hexdigest() == run.required['manifest_sha256'] and run.config['planSha256'] == run.required['plan_sha256'], 'run_hash_mismatch')
    plan_ref = 'hwo_' + run.orders['single_payment']['order_id'].replace('-', '')
    rep['run'] = {'run_id': run.id, 'manifest_sha256': run.required['manifest_sha256'], 'plan_sha256': run.required['plan_sha256'], 'reference': plan_ref, 'amount_kobo': run.orders['single_payment']['amount_kobo'], 'ledger_volume': run.ledger, 'counter_volume': run.counter}
    require(run.orders['single_payment']['amount_kobo'] == 10000, 'amount_not_10000')
    # Image: the exact reviewed relay/Backend image.
    img = sh('docker', 'image', 'inspect', c['image'], '--format', '{{.Id}}', check=False).stdout.strip()
    require(img == c['image_id'], 'image_mismatch')
    # Ledger and counter: untouched, right budget.
    st = run.bridge('status'); rep['ledger'] = st
    require(st['intent_count'] == 0 and st['provider_dispatch_count'] == 0 and not st['run_stopped'], 'ledger_not_fresh')
    r = sh('docker', 'run', '--rm', '--network', 'none', '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '-v', run.counter + ':/run/provider-counter:ro',
           '--entrypoint', 'node', c['image'], 'release/provider-execution/provider-counter.cjs', '--inspect', '/run/provider-counter', check=False)
    require(r.returncode == 0, 'counter_unavailable')
    cnt = json.loads(r.stdout); rep['counter'] = {k: cnt[k] for k in ('budget', 'dispatched', 'records', 'open_dispatches', 'locked')}
    require(cnt['budget'] == {'initialize': 1, 'read': 3, 'refund': 0} and cnt['records'] == 0 and not cnt['locked'] and cnt['plan_sha256'] == run.required['plan_sha256'], 'counter_not_fresh')
    # Reservation.
    rep['hold_seconds'] = hold_seconds(run)
    # Network isolation and no other financial process.
    net = json.loads(sh('docker', 'network', 'inspect', c['private']).stdout)[0]
    require(net['Internal'] is True, 'private_network_not_internal')
    running = sh('docker', 'ps', '--format', '{{.Names}}').stdout.split()
    others = [n for n in running if n.startswith(c['relay_prefix']) and n != run.relay]
    require(not others, 'other_financial_relay_running')
    require(c['probe'] not in running, 'probe_egress_running')
    # Public GetOyi checkout/payments stay off.
    g = inspect(c['getoyi']); require(g is not None, 'getoyi_missing')
    ge = env_of(g)
    require(all(ge.get(k) == 'false' for k in ('HARDWARE_CATALOGUE_ENABLED', 'HARDWARE_CHECKOUT_ENABLED', 'HARDWARE_PAYMENTS_ENABLED')), 'public_checkout_not_disabled')
    # Merchant key: the dedicated test key with the owner-matched fingerprint (fingerprint only; key never printed).
    if not c['test']:
        r = sh('python3', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'verify-test-key-fingerprint.py'), '--compare', c['key_fingerprint'], check=False)
        k = json.loads(r.stdout or '{}')
        require(k.get('ok') and k.get('test_mode_key') and not k.get('live_key') and k.get('matches_owner_dashboard_fingerprint') and k.get('backend_mount_matches_runtime'), 'merchant_key_check_failed')
    rep['merchant_key_fingerprint'] = c['key_fingerprint'] if not c['test'] else 'skipped_in_test_config'
    rep['check_seconds'] = round(time.time() - t0, 2)
    return run, rep

def install(c, run_id):
    run, rep = check(c, run_id)
    src = os.path.join(run.dir, 'authorization.json')
    h = validate_authorization(run, src)
    st = run.bridge('status'); require(not st['run_enabled'], 'run_already_armed')
    data = open(src, 'rb').read()
    r = sh('docker', 'run', '--rm', '-i', '--network', 'none', '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '-v', run.ledger + ':/run/execution',
           '--entrypoint', 'python3', c['image'], '-c',
           "import sys,os,hashlib;d=sys.stdin.buffer.read();p='/run/execution/authorization.json';fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);os.write(fd,d);os.close(fd);print(hashlib.sha256(open(p,'rb').read()).hexdigest())",
           input=data.decode(), check=False)
    require(r.returncode == 0 and r.stdout.strip() == h, 'authorization_copy_failed_or_exists')
    return {'installed': True, 'authorization_sha256': h, 'armed': False, 'next': 'owner-authorized: control.py --arm-approved-run (this script never arms)'}

# ---- container definitions -------------------------------------------------------------------------------------
def clone_args(src, name, env, image, cmd, workdir, user, read_only, tmpfs, cap_add, binds, network, aliases, labels):
    a = ['docker', 'create', '--name', name, '--network', network, '--restart', 'no', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges']
    for al in aliases: a += ['--network-alias', al]
    for x in cap_add: a += ['--cap-add', x]
    if read_only: a.append('--read-only')
    for k, v in tmpfs.items(): a += ['--tmpfs', k + ':' + v]
    for b in binds: a += ['-v', b]
    for k, v in labels.items(): a += ['--label', k + '=' + v]
    if user is not None: a += ['--user', user]
    if workdir: a += ['-w', workdir]
    return a, env, [image] + cmd

def create(args, env):
    a, env_items, tail = args
    fd, fd_path = tempfile.mkstemp(prefix='.stage-', dir=CFG['runtime'])
    try:
        with os.fdopen(fd, 'w') as f: f.write('\n'.join(k + '=' + v for k, v in env_items.items()) + '\n')
        os.chmod(fd_path, 0o600)
        sh(*(a + ['--env-file', fd_path] + tail))
    finally:
        os.unlink(fd_path)

def backend_spec(c, run, setup):
    e = {k: v for k, v in env_of(setup).items()}
    e.update({'HARDWARE_BOUNDED_EXECUTION_ENABLED': 'true', 'HARDWARE_EXECUTION_PROFILE': 'single-payment-acceptance', 'HARDWARE_PAYMENT_INITIALIZATION_ENABLED': 'true',
              'HARDWARE_PAYMENT_PROCESSING_ENABLED': 'true', 'HARDWARE_FINANCIAL_RECOVERY_ENABLED': 'false', 'HARDWARE_REFUNDS_ENABLED': 'false',
              'PROVIDER_FINANCIAL_RELAY_ENABLED': 'false', 'PROVIDER_FINANCIAL_EXECUTION_ENABLED': 'false'})
    binds = list(setup['HostConfig'].get('Binds') or []) + [run.ledger + ':/run/execution']
    return clone_args(setup, c['backend'], e, c['image'], ['node', 'release/provider-execution/execution-server.cjs'], '/app/backend', None, True,
                      {'/tmp': 'rw,noexec,nosuid,size=32m'}, ['SETUID', 'SETGID'], binds, c['private'], [c['backend']],
                      {'getoyi.isolated.setup': 'true', 'getoyi.isolated.execution': 'true', 'getoyi.run': run.id}), e

def office_spec(c, run, setup, window_path):
    e = {k: v for k, v in env_of(setup).items()}
    e.update({'HARDWARE_BOUNDED_EXECUTION_ENABLED': 'true', 'OFFICE_HARDWARE_PAYMENTS_ENABLED': 'true', 'OFFICE_HARDWARE_PAYMENT_PROCESSING_ENABLED': 'true',
              'OFFICE_HARDWARE_FINANCIAL_ENABLED': 'true', 'HARDWARE_TEST_EXECUTION_WINDOW': run.id,
              'HARDWARE_TEST_MANIFEST_SHA256': run.required['manifest_sha256'], 'HARDWARE_TEST_PLAN_SHA256': run.required['plan_sha256']})
    guard = os.path.join(c['setup_dir'], 'guard-bounded-office.cjs')
    binds = [b for b in (setup['HostConfig'].get('Binds') or []) if not b.split(':')[1] == '/guard.cjs'] + [guard + ':/guard.cjs:ro', window_path + ':/run/execution/office-window.json:ro']
    return clone_args(setup, c['office'], e, setup['Config']['Image'], list(setup['Config']['Cmd']), setup['Config']['WorkingDir'], setup['Config']['User'] or None, False,
                      {}, [], binds, c['private'], [], {'getoyi.isolated.setup': 'true', 'getoyi.run': run.id}), e

def relay_spec(c, run):
    key = os.path.join(c['runtime'], 'provider-test-key')
    e = {'PROVIDER_FINANCIAL_RELAY_ENABLED': 'true', 'PROVIDER_FINANCIAL_EXECUTION_ENABLED': 'true', 'HARDWARE_BOUNDED_EXECUTION_ENABLED': 'false'}
    binds = [run.ledger + ':/run/execution', run.counter + ':/run/provider-counter', key + ':/run/secrets/hardware-test-key:ro']
    return clone_args(None, run.relay, e, c['image'], ['node', 'release/provider-execution/financial-relay.cjs'], '/app/backend', None, True,
                      {'/tmp': 'rw,noexec,nosuid,size=16m'}, ['NET_ADMIN', 'SETUID', 'SETGID', 'DAC_OVERRIDE'], binds, c['private'], ['hardware-provider-egress'],
                      {'getoyi.isolated.execution': 'true', 'getoyi.run': run.id}), e

SETTLE_S = 2.5  # a service that refuses its configuration exits within this time (startup guards are synchronous)
def wait_running(name, started, timeout=10):
    while time.time() - started < timeout:
        c = inspect(name)
        if c is None or c['State']['Status'] in ('exited', 'dead'): return False
        if c['State']['Running'] and time.time() - started >= SETTLE_S: return True
        time.sleep(0.25)
    return False

def exec_status(name, url, headers=None, timeout=10, body='{}'):
    # Probe from inside the container (loopback only), retrying until the server listens. No credential is sent.
    js = "fetch(process.argv[1],{method:'POST',headers:JSON.parse(process.argv[2]),body:process.argv[3]}).then(r=>console.log(r.status)).catch(()=>console.log('ERR'))"
    t = time.time(); out = 'ERR'
    while time.time() - t < timeout:
        out = sh('docker', 'exec', name, 'node', '-e', js, url, json.dumps({'content-type': 'application/json', **(headers or {})}), body, check=False).stdout.strip()
        if out != 'ERR': return out
        time.sleep(0.3)
    return out

def start(c, run_id, window_end):
    t0 = time.time(); steps = []
    def mark(s): steps.append({'step': s, 't': round(time.time() - t0, 2)})
    run, rep = check(c, run_id); mark('checks_passed')
    try: end = calendar.timegm(time.strptime(window_end, '%Y-%m-%dT%H:%M:%SZ'))
    except Exception: raise Refused('window_end_invalid')
    now = time.time()
    require(now < end and end - now <= 3600, 'window_closed_or_too_long')
    validate_authorization(run, os.path.join(run.dir, 'authorization.json'))
    st = run.bridge('status')
    require(st['run_enabled'] and not st['run_stopped'] and st['intent_count'] == 0, 'run_not_armed_or_not_fresh')
    require(rep['hold_seconds'] >= HOLD_START_S, 'reservation_hold_insufficient')
    setup_b, setup_o = inspect(c['backend']), inspect(c['office'])
    require(setup_b and setup_o and setup_b['Config']['Labels'].get('getoyi.run') is None and setup_o['Config']['Labels'].get('getoyi.run') is None, 'setup_services_not_in_setup_state')
    require(all(env_of(setup_b).get(k) == 'false' for k in ('HARDWARE_PAYMENT_INITIALIZATION_ENABLED', 'HARDWARE_PAYMENT_PROCESSING_ENABLED', 'HARDWARE_FINANCIAL_RECOVERY_ENABLED', 'HARDWARE_REFUNDS_ENABLED')), 'setup_backend_switches_not_off')
    require(inspect(run.relay) is None, 'relay_already_exists')
    # Office execution window: derived only from the owner's validated authorization; expires at the earlier of the
    # signed window end and the 30-minute run deadline.
    window = {'run_id': run.id, 'environment': 'test', 'authorized': True, 'expires_at': int(min(end, now + 1800) * 1000),
              'manifest_sha256': run.required['manifest_sha256'], 'plan_sha256': run.required['plan_sha256']}
    wpath = os.path.join(run.dir, 'office-window.json')
    fd = os.open(wpath, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600); os.write(fd, (json.dumps(window) + '\n').encode()); os.close(fd)
    stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
    done = []
    try:
        # 1. Relay (provider-only egress; durable counter; refuses to start on any mismatch).
        spec, env = relay_spec(c, run); create(spec, env); done.append('relay')
        sh('docker', 'network', 'connect', c['egress'], run.relay)
        t = time.time(); sh('docker', 'start', run.relay)
        require(wait_running(run.relay, t), 'relay_start_failed')
        line = next((l for l in sh('docker', 'logs', run.relay).stdout.splitlines() if l.startswith('{')), '{}')
        rl = json.loads(line)
        require(rl.get('relay') == 'bounded-financial' and rl.get('counter', {}).get('dispatched') == {'initialize': 0, 'refund': 0, 'read': 0}, 'relay_not_bounded_or_counter_not_zero')
        fw = sh('docker', 'exec', run.relay, 'iptables', '-L', 'OUTPUT', '-v', '-x', '-n').stdout
        require('policy DROP' in fw and 'getoyi-provider-new' in fw and 'getoyi-denied' in fw and re.search(r'^\s*0\s+0\s+ACCEPT.*getoyi-provider-new', fw, re.M), 'relay_firewall_invalid')
        rn = set(inspect(run.relay)['NetworkSettings']['Networks']); require(rn == {c['private'], c['egress']}, 'relay_networks_invalid')
        mark('relay_ready')
        # 2. Bounded Backend in place of the setup Backend (setup kept as a stopped named backup).
        sh('docker', 'stop', '-t', str(STOP_S), c['backend']); sh('docker', 'rename', c['backend'], c['backend'] + '-before-run-' + run.id); done.append('backend_backup')
        spec, env = backend_spec(c, run, setup_b); create(spec, env); done.append('backend')
        t = time.time(); sh('docker', 'start', c['backend'])
        require(wait_running(c['backend'], t), 'bounded_backend_start_failed')
        # A well-formed reconcile without the service credential must be refused by authentication (403); an empty body
        # never reaches authentication (400, no sweep); a route outside the profile does not exist (404).
        require(exec_status(c['backend'], 'http://127.0.0.1:3000/hardware-payments/reconcile', body=json.dumps({'reference': 'hwo_' + '0' * 32})) == '403', 'bounded_backend_auth_not_enforced')
        require(exec_status(c['backend'], 'http://127.0.0.1:3000/hardware-payments/reconcile') == '400', 'bounded_backend_sweep_not_refused')
        require(exec_status(c['backend'], 'http://127.0.0.1:3000/hardware-payments/recover') == '404', 'bounded_backend_surface_invalid')
        require(set(inspect(c['backend'])['NetworkSettings']['Networks']) == {c['private']}, 'backend_networks_invalid')
        mark('backend_ready')
        # 3. Bounded Office in place of the setup Office.
        sh('docker', 'stop', '-t', str(STOP_S), c['office']); sh('docker', 'rename', c['office'], c['office'] + '-before-run-' + run.id); done.append('office_backup')
        spec, env = office_spec(c, run, setup_o, wpath); create(spec, env); done.append('office')
        t = time.time(); sh('docker', 'start', c['office'])
        require(wait_running(c['office'], t), 'bounded_office_start_failed')
        oe = env_of(inspect(c['office']))
        require(all(oe.get(k) == 'true' for k in ('OFFICE_HARDWARE_PAYMENTS_ENABLED', 'OFFICE_HARDWARE_PAYMENT_PROCESSING_ENABLED', 'OFFICE_HARDWARE_FINANCIAL_ENABLED')), 'office_switches_not_on')
        require(set(inspect(c['office'])['NetworkSettings']['Networks']) == {c['private']}, 'office_networks_invalid')
        mark('office_ready')
        # 4. Final gates: unarmed counters, public checkout off, hold still sufficient.
        st = run.bridge('status'); require(st['run_enabled'] and st['intent_count'] == 0 and st['provider_dispatch_count'] == 0, 'ledger_changed_during_start')
        h = hold_seconds(run); require(h >= HOLD_INIT_S, 'reservation_hold_insufficient_after_start')
        ge = env_of(inspect(c['getoyi'])); require(all(ge.get(k) == 'false' for k in ('HARDWARE_CATALOGUE_ENABLED', 'HARDWARE_CHECKOUT_ENABLED', 'HARDWARE_PAYMENTS_ENABLED')), 'public_checkout_not_disabled')
        mark('ready')
        return {'ready': True, 'run_id': run.id, 'hold_seconds': h, 'relay_counter': rl['counter']['dispatched'], 'office_switches': 'payments,processing,financial=true',
                'provider_requests': 0, 'steps': steps, 'next': 'run.cjs hold single_payment, then run.cjs initialize single_payment (operator, owner-supervised)'}
    except Exception as e:
        rollback(c, run, done, stamp)
        code = str(e) if isinstance(e, Refused) else 'start_failed_' + type(e).__name__
        raise Refused(code + ':rolled_back')

def rollback(c, run, done, stamp):
    # Fail closed: disable the ledger first, then put the setup services back exactly as they were.
    run.container('python3', 'release/provider-execution/control.py', '--disable')
    if 'office' in done or 'office_backup' in done:
        if inspect(c['office']) and 'office' in done: sh('docker', 'stop', '-t', '5', c['office'], check=False); sh('docker', 'rename', c['office'], c['office'] + '-failed-' + run.id + '-' + stamp, check=False)
        if 'office_backup' in done: sh('docker', 'rename', c['office'] + '-before-run-' + run.id, c['office'], check=False); sh('docker', 'start', c['office'], check=False)
    if 'backend' in done or 'backend_backup' in done:
        if inspect(c['backend']) and 'backend' in done: sh('docker', 'stop', '-t', '5', c['backend'], check=False); sh('docker', 'rename', c['backend'], c['backend'] + '-failed-' + run.id + '-' + stamp, check=False)
        if 'backend_backup' in done: sh('docker', 'rename', c['backend'] + '-before-run-' + run.id, c['backend'], check=False); sh('docker', 'start', c['backend'], check=False)
    if 'relay' in done and inspect(run.relay):
        sh('docker', 'stop', '-t', '10', run.relay, check=False)
        for n in list((inspect(run.relay) or {}).get('NetworkSettings', {}).get('Networks', {})): sh('docker', 'network', 'disconnect', n, run.relay, check=False)

def stop(c, run_id):
    run = Run(c, run_id); out = {}
    run.container('python3', 'release/provider-execution/control.py', '--disable'); out['ledger'] = run.bridge('status')
    if inspect(run.relay):
        sh('docker', 'stop', '-t', '10', run.relay, check=False)
        lines = [l for l in sh('docker', 'logs', run.relay).stdout.splitlines() if l.startswith('{')]
        out['relay_final'] = json.loads(lines[-1]) if lines else None
        for n in list(inspect(run.relay)['NetworkSettings']['Networks']): sh('docker', 'network', 'disconnect', n, run.relay, check=False)
    for svc in (c['office'], c['backend']):
        cur = inspect(svc)
        if cur and cur['Config']['Labels'].get('getoyi.run') == run.id:
            sh('docker', 'stop', '-t', str(STOP_S), svc, check=False); sh('docker', 'rename', svc, svc + '-run-' + run.id + '-stopped', check=False)
        if inspect(svc + '-before-run-' + run.id) and not inspect(svc):
            sh('docker', 'rename', svc + '-before-run-' + run.id, svc); sh('docker', 'start', svc)
    b, o = env_of(inspect(c['backend'])), env_of(inspect(c['office']))
    out['setup_restored'] = all(b.get(k) == 'false' for k in ('HARDWARE_PAYMENT_INITIALIZATION_ENABLED', 'HARDWARE_PAYMENT_PROCESSING_ENABLED', 'HARDWARE_REFUNDS_ENABLED')) and o.get('OFFICE_HARDWARE_PAYMENTS_ENABLED') == 'false'
    require(out['setup_restored'], 'setup_not_restored')
    return out

CFG = None
def main():
    global CFG
    a = sys.argv[1:]
    require(len(a) >= 2 and a[0] in ('check', 'install', 'start', 'stop'), 'usage')
    CFG = config()
    if a[0] == 'check': _, rep = check(CFG, a[1]); rep['ready_for_start_after_arming'] = rep['hold_seconds'] >= HOLD_START_S; out = rep
    elif a[0] == 'install': out = install(CFG, a[1])
    elif a[0] == 'start':
        require(len(a) == 4 and a[2] == '--window-end', 'usage'); out = start(CFG, a[1], a[3])
    else: out = stop(CFG, a[1])
    print(json.dumps(out, indent=1))

if __name__ == '__main__':
    try: main()
    except Refused as e:
        code = str(e); print(json.dumps({'result': 'REFUSED', 'code': code if SAFE_ERR.match(code.replace(':rolled_back', '')) else 'refused'})); sys.exit(1)
    except Exception as e:
        print(json.dumps({'result': 'FAILED', 'type': type(e).__name__})); sys.exit(1)
