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
it is refused unless every container, network and volume name starts with 'hwtest-', the run root and setup directory are
not the real ones, the reviewed image is used, and the test key is a synthetic regular file (never the real key).

Fail-closed rollback and close-down are state-driven (they inspect what exists rather than trusting progress flags), run
every step even if an earlier one fails, ignore further signals while running, and verify the end state: ledger disabled,
relay stopped with no network, no bounded service running or networked, setup services running with their exact pre-start
configuration, office-window.json expired. Any unverified item is reported as rollback_incomplete / stop_incomplete.
"""
import calendar, hashlib, json, os, re, signal, stat, subprocess, sys, tempfile, time

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

class Refused(RuntimeError):
    def __init__(self, code, issues=()): super().__init__(code); self.issues = list(issues)
class Interrupted(BaseException): pass
def require(cond, code):
    if not cond: raise Refused(code)
def _interrupt(signum, frame): raise Interrupted('signal_' + str(signum))
def trap_signals(): [signal.signal(s, _interrupt) for s in (signal.SIGTERM, signal.SIGHUP)]  # SIGINT already raises KeyboardInterrupt
def ignore_signals(): [signal.signal(s, signal.SIG_IGN) for s in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)]
def key_fingerprint(path):
    st = os.lstat(path)
    if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1: return None
    return hashlib.sha256(open(path).read().strip().encode()).hexdigest()[:16]

def config():
    p = os.environ.get('STAGE_RUN_TEST_CONFIG')
    if not p: return dict(REAL)
    c = {**REAL, **json.load(open(p)), 'test': True}
    names = [c[k] for k in ('private', 'egress', 'backend', 'office', 'getoyi', 'office_db', 'probe', 'relay_prefix', 'ledger_prefix', 'counter_prefix')]
    real_root = os.path.realpath(REAL['setup_dir'])
    rt, sd = os.path.realpath(c['runtime']), os.path.realpath(c['setup_dir'])
    require(all(n.startswith('hwtest-') for n in names) and rt != os.path.realpath(REAL['runtime']) and sd != real_root
            and not rt.startswith(real_root + os.sep) and not sd.startswith(real_root + os.sep), 'test_config_must_be_disposable')
    require(c['image'] == REAL['image'] and c['image_id'] == REAL['image_id'], 'test_config_must_use_reviewed_image')
    try: fp = key_fingerprint(os.path.join(c['runtime'], 'provider-test-key'))
    except OSError: fp = None
    require(fp is not None and fp != REAL['key_fingerprint'], 'test_config_key_not_synthetic')
    return c

def sh(*a, check=True, input=None, timeout=120):  # may raise TimeoutExpired even with check=False
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
        return sh('docker', 'run', '--rm', '--pull', 'never', '--network', network, '--user', user, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                  '-v', self.ledger + ':/run/execution', *extra, '--entrypoint', cmd[0], self.c['image'], *cmd[1:], check=False)
    def bridge(self, action):
        q = {'database': '/run/execution/run.sqlite', 'manifest': self.config['manifest'], 'mode': 'real-provider', 'plan_sha256': self.config['planSha256'], 'action': action}
        r = self.container('python3', '-c', "import sys,json;sys.path.insert(0,'release/provider-execution');from bridge import main;print(json.dumps(main(json.loads(sys.argv[1]))))", json.dumps(q))
        require(r.returncode == 0, 'ledger_status_unavailable')
        return json.loads(r.stdout.strip().splitlines()[-1])
    def ledger_facts(self):
        # Read-only: what the ledger itself is bound to (manifest digest, registered plan, installed authorization).
        py = ("import sqlite3,hashlib,os,json;d=sqlite3.connect('file:/run/execution/run.sqlite?mode=ro',uri=True);m=d.execute('select manifest from run where id=1').fetchone()[0];"
              "p=d.execute('select value from execution_plan where id=1').fetchone()[0];a='/run/execution/authorization.json';"
              "print(json.dumps({'manifest_sha256':m,'plan_sha256':hashlib.sha256(p.encode()).hexdigest(),'authorization_sha256':hashlib.sha256(open(a,'rb').read()).hexdigest() if os.path.isfile(a) else None}))")
        r = sh('docker', 'run', '--rm', '--pull', 'never', '--network', 'none', '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
               '-v', self.ledger + ':/run/execution:ro', '--entrypoint', 'python3', self.c['image'], '-c', py, check=False)
        require(r.returncode == 0, 'ledger_facts_unavailable')
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
    try: fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError: raise Refused('authorization_file_missing_or_unsafe')
    try:
        st = os.fstat(fd)
        require(stat.S_ISREG(st.st_mode) and (st.st_mode & 0o077) == 0 and st.st_uid == os.getuid() and st.st_nlink == 1, 'authorization_file_missing_or_unsafe')
        raw = b''
        while True:
            chunk = os.read(fd, 65536)
            if not chunk: break
            raw += chunk
            require(len(raw) <= 4096, 'authorization_file_missing_or_unsafe')
    finally: os.close(fd)
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
    order = run.orders['single_payment']['order_id']
    require(isinstance(order, str) and re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', order), 'invalid_order')
    plan_ref = 'hwo_' + order.replace('-', '')
    # The order used for the hold gate must be the one the plan (and therefore the owner's authorization) binds.
    plan = [{'reference': plan_ref, 'scenario': 'single_payment', 'amount': 10000}]
    require(hashlib.sha256(canonical(plan).encode()).hexdigest() == run.required['plan_sha256'], 'order_not_bound_to_plan')
    rep['run'] = {'run_id': run.id, 'manifest_sha256': run.required['manifest_sha256'], 'plan_sha256': run.required['plan_sha256'], 'reference': plan_ref, 'amount_kobo': run.orders['single_payment']['amount_kobo'], 'ledger_volume': run.ledger, 'counter_volume': run.counter}
    require(run.orders['single_payment']['amount_kobo'] == 10000, 'amount_not_10000')
    # Image: the exact reviewed relay/Backend image.
    img = sh('docker', 'image', 'inspect', c['image'], '--format', '{{.Id}}', check=False).stdout.strip()
    require(img == c['image_id'], 'image_mismatch')
    # Ledger and counter: untouched, right budget.
    st = run.bridge('status'); rep['ledger'] = st
    require(st['intent_count'] == 0 and st['provider_dispatch_count'] == 0 and not st['run_stopped'] and st['mode'] in (None, 'real-provider'), 'ledger_not_fresh')
    lf = run.ledger_facts(); rep['ledger_authorization_sha256'] = lf['authorization_sha256']
    require(lf['manifest_sha256'] == run.required['manifest_sha256'] and lf['plan_sha256'] == run.required['plan_sha256'], 'ledger_not_bound_to_run')
    r = sh('docker', 'run', '--rm', '--pull', 'never', '--network', 'none', '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '-v', run.counter + ':/run/provider-counter:ro',
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
    r = sh('docker', 'run', '--rm', '-i', '--pull', 'never', '--network', 'none', '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '-v', run.ledger + ':/run/execution',
           '--entrypoint', 'python3', c['image'], '-c',
           "import sys,os,hashlib;d=sys.stdin.buffer.read();p='/run/execution/authorization.json';fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);os.write(fd,d);os.close(fd);print(hashlib.sha256(open(p,'rb').read()).hexdigest())",
           input=data.decode(), check=False)
    require(r.returncode == 0 and r.stdout.strip() == h, 'authorization_copy_failed_or_exists')
    return {'installed': True, 'authorization_sha256': h, 'armed': False, 'next': 'owner-authorized: control.py --arm-approved-run (this script never arms)'}

# ---- container definitions -------------------------------------------------------------------------------------
def clone_args(src, name, env, image, cmd, workdir, user, read_only, tmpfs, cap_add, binds, network, aliases, labels):
    a = ['docker', 'create', '--pull', 'never', '--name', name, '--network', network, '--restart', 'no', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges']
    for al in aliases: a += ['--network-alias', al]
    for x in cap_add: a += ['--cap-add', x]
    if read_only: a.append('--read-only')
    for k, v in tmpfs.items(): a += ['--tmpfs', k + ':' + v]
    for b in binds: a += ['-v', b]
    for k, v in labels.items(): a += ['--label', k + '=' + v]
    if user is not None: a += ['--user', user]
    if workdir: a += ['-w', workdir]
    return a, env, [image] + cmd

ENV_KEY = re.compile(r'[A-Z][A-Z0-9_]*')
def create(args, env):
    a, env_items, tail = args
    # An env-file line is KEY=VALUE up to the newline: a value containing a line break could inject another variable.
    require(all(ENV_KEY.fullmatch(k) and not any(ch in v for ch in '\n\r\0') for k, v in env_items.items()), 'container_env_unsafe')
    fd, fd_path = tempfile.mkstemp(prefix='.stage-', dir=CFG['runtime'])
    try:
        with os.fdopen(fd, 'w') as f: f.write('\n'.join(k + '=' + v for k, v in env_items.items()) + '\n')
        os.chmod(fd_path, 0o600)
        sh(*(a + ['--env-file', fd_path] + tail))
    finally:
        os.unlink(fd_path)
    # The created container must have exactly the intended environment (plus image defaults the intent does not set).
    name, image = a[a.index('--name') + 1], tail[0]
    img_env = dict(e.split('=', 1) for e in (json.loads(sh('docker', 'image', 'inspect', image).stdout)[0]['Config']['Env'] or []))
    require(env_of(inspect(name)) == {**img_env, **env_items}, 'container_env_mismatch')

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

BACKEND_OFF = ('HARDWARE_PAYMENT_INITIALIZATION_ENABLED', 'HARDWARE_PAYMENT_PROCESSING_ENABLED', 'HARDWARE_FINANCIAL_RECOVERY_ENABLED', 'HARDWARE_REFUNDS_ENABLED')
OFFICE_OFF = ('OFFICE_HARDWARE_PAYMENTS_ENABLED', 'OFFICE_HARDWARE_PAYMENT_PROCESSING_ENABLED')
def env_hash(c): return hashlib.sha256(canonical(sorted(c['Config']['Env'])).encode()).hexdigest()
def run_containers(run, all_=False):
    a = ['docker', 'ps', '--filter', 'label=getoyi.run=' + run.id, '--format', '{{.Names}}'] + (['-a'] if all_ else [])
    return sh(*a, check=False).stdout.split()

def start(c, run_id, window_end):
    t0 = time.time(); steps = []
    def mark(s): steps.append({'step': s, 't': round(time.time() - t0, 2)})
    run, rep = check(c, run_id); mark('checks_passed')
    # The window end is entered by the operator (from the owner's signed Stage 1); it only ever shortens the run.
    try: end = calendar.timegm(time.strptime(window_end, '%Y-%m-%dT%H:%M:%SZ'))
    except Exception: raise Refused('window_end_invalid')
    now = time.time()
    require(now < end and end - now <= 3600, 'window_closed_or_too_long')
    auth_sha = validate_authorization(run, os.path.join(run.dir, 'authorization.json'))
    st = run.bridge('status')
    require(st['run_enabled'] and not st['run_stopped'] and st['intent_count'] == 0 and st['mode'] == 'real-provider', 'run_not_armed_or_not_fresh')
    require(rep['ledger_authorization_sha256'] == auth_sha, 'ledger_authorization_differs_from_owner_file')
    require(rep['hold_seconds'] >= HOLD_START_S, 'reservation_hold_insufficient')
    setup_b, setup_o = inspect(c['backend']), inspect(c['office'])
    require(setup_b and setup_o and setup_b['Config']['Labels'].get('getoyi.run') is None and setup_o['Config']['Labels'].get('getoyi.run') is None
            and setup_b['State']['Running'] and setup_o['State']['Running'], 'setup_services_not_in_setup_state')
    require(all(env_of(setup_b).get(k) == 'false' for k in BACKEND_OFF) and all(env_of(setup_o).get(k) == 'false' for k in OFFICE_OFF), 'setup_switches_not_off')
    require(inspect(run.relay) is None and not run_containers(run, all_=True), 'run_already_started')
    for svc in (c['backend'], c['office']): require(inspect(svc + '-before-run-' + run.id) is None, 'run_already_started')
    stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
    wpath = os.path.join(run.dir, 'office-window.json')
    trap_signals()
    try:
        # Pre-start configuration fingerprints (hashes only; the env holds service credentials and is never written).
        fd = os.open(os.path.join(run.dir, 'setup-env-before.json'), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.write(fd, json.dumps({c['backend']: env_hash(setup_b), c['office']: env_hash(setup_o)}).encode()); os.close(fd)
        # Office execution window: written only after the owner's validated authorization is confirmed installed in the
        # armed ledger; expires at the earlier of the window end and the 30-minute run deadline.
        window = {'run_id': run.id, 'environment': 'test', 'authorized': True, 'expires_at': int(min(end, now + 1800) * 1000),
                  'manifest_sha256': run.required['manifest_sha256'], 'plan_sha256': run.required['plan_sha256']}
        fd = os.open(wpath, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600); os.write(fd, (json.dumps(window) + '\n').encode()); os.close(fd)
        # 1. Bounded Backend in place of the setup Backend (setup kept as a stopped named backup). It is probed BEFORE the
        # relay exists, so a broken authentication or sweep check cannot reach the provider.
        sh('docker', 'stop', '-t', str(STOP_S), c['backend']); sh('docker', 'rename', c['backend'], c['backend'] + '-before-run-' + run.id)
        spec, env = backend_spec(c, run, setup_b); create(spec, env)
        t = time.time(); sh('docker', 'start', c['backend'])
        require(wait_running(c['backend'], t), 'bounded_backend_start_failed')
        # A well-formed reconcile without the service credential must be refused by authentication (403); an empty body
        # never reaches authentication (400, no sweep); a route outside the profile does not exist (404).
        require(exec_status(c['backend'], 'http://127.0.0.1:3000/hardware-payments/reconcile', body=json.dumps({'reference': 'hwo_' + '0' * 32})) == '403', 'bounded_backend_auth_not_enforced')
        require(exec_status(c['backend'], 'http://127.0.0.1:3000/hardware-payments/reconcile') == '400', 'bounded_backend_sweep_not_refused')
        require(exec_status(c['backend'], 'http://127.0.0.1:3000/hardware-payments/recover') == '404', 'bounded_backend_surface_invalid')
        require(set(inspect(c['backend'])['NetworkSettings']['Networks']) == {c['private']}, 'backend_networks_invalid')
        mark('backend_ready')
        # 2. Relay (provider-only egress; durable counter; refuses to start on any mismatch).
        spec, env = relay_spec(c, run); create(spec, env)
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
        # 3. Bounded Office in place of the setup Office.
        sh('docker', 'stop', '-t', str(STOP_S), c['office']); sh('docker', 'rename', c['office'], c['office'] + '-before-run-' + run.id)
        spec, env = office_spec(c, run, setup_o, wpath); create(spec, env)
        t = time.time(); sh('docker', 'start', c['office'])
        require(wait_running(c['office'], t), 'bounded_office_start_failed')
        oe = env_of(inspect(c['office']))
        require(all(oe.get(k) == 'true' for k in ('OFFICE_HARDWARE_PAYMENTS_ENABLED', 'OFFICE_HARDWARE_PAYMENT_PROCESSING_ENABLED', 'OFFICE_HARDWARE_FINANCIAL_ENABLED')), 'office_switches_not_on')
        require(set(inspect(c['office'])['NetworkSettings']['Networks']) == {c['private']}, 'office_networks_invalid')
        mark('office_ready')
        # 4. Final gates: no dispatch yet, public checkout off, hold still sufficient.
        st = run.bridge('status'); require(st['run_enabled'] and st['intent_count'] == 0 and st['provider_dispatch_count'] == 0, 'ledger_changed_during_start')
        h = hold_seconds(run); require(h >= HOLD_INIT_S, 'reservation_hold_insufficient_after_start')
        ge = env_of(inspect(c['getoyi'])); require(all(ge.get(k) == 'false' for k in ('HARDWARE_CATALOGUE_ENABLED', 'HARDWARE_CHECKOUT_ENABLED', 'HARDWARE_PAYMENTS_ENABLED')), 'public_checkout_not_disabled')
        mark('ready')
        for s in (signal.SIGTERM, signal.SIGHUP): signal.signal(s, signal.SIG_DFL)
        return {'ready': True, 'run_id': run.id, 'hold_seconds': h, 'relay_counter': rl['counter']['dispatched'], 'office_switches': 'payments,processing,financial=true',
                'window_end_operator_entered': window_end, 'office_window_expires_at_ms': window['expires_at'],
                'provider_requests': 0, 'steps': steps, 'next': 'run.cjs hold single_payment, then run.cjs initialize single_payment (operator, owner-supervised)'}
    except BaseException as e:  # includes KeyboardInterrupt, SIGTERM/SIGHUP (Interrupted), timeouts and SystemExit
        ignore_signals()
        code = str(e) if isinstance(e, Refused) and SAFE_ERR.match(str(e)) else 'start_interrupted' if isinstance(e, (KeyboardInterrupt, Interrupted)) else 'start_failed_' + type(e).__name__
        _, issues = close_down(c, run, '-failed-' + run.id + '-' + stamp, stamp, settle=True)
        raise Refused(code + (':rolled_back' if not issues else ':rollback_incomplete'), issues)

def close_down(c, run, suffix, stamp, settle=False):
    """Shared by rollback and stop. Every step runs even if an earlier one fails; the end state is then verified.
    settle=True (rollback): an interrupted `docker stop` client does not cancel the daemon's stop, which can complete after
    the setup service was restored, so restoration is repeated once any in-flight stop has had time to finish."""
    out, issues, restorers = {}, [], []
    def step(name, fn):
        try: fn()
        except BaseException: issues.append(name)
    # 1. Ledger first: nothing can be dispatched once the run is disabled.
    step('ledger_disable', lambda: require(run.container('python3', 'release/provider-execution/control.py', '--disable').returncode == 0, 'disable_failed'))
    # 2. Relay next: stop it and remove every network, so it has no egress even if anything later fails.
    def relay():
        if inspect(run.relay) is None: return
        try: sh('docker', 'stop', '-t', '10', run.relay, check=False, timeout=60)
        finally:
            for n in list((inspect(run.relay) or {}).get('NetworkSettings', {}).get('Networks', {}) or {}): sh('docker', 'network', 'disconnect', '-f', n, run.relay, check=False, timeout=60)
        lines = [l for l in sh('docker', 'logs', run.relay, check=False, timeout=60).stdout.splitlines() if l.startswith('{')]
        out['relay_final'] = json.loads(lines[-1]) if lines else None
    step('relay_close', relay)
    # 3. Bounded services: stop, detach from every network, keep for evidence under a new name; then restore setup.
    for svc, role in ((c['office'], 'office'), (c['backend'], 'backend')):
        def quarantine(svc=svc):
            cur = inspect(svc)
            if cur and cur['Config']['Labels'].get('getoyi.run') == run.id:
                try: sh('docker', 'stop', '-t', str(STOP_S), svc, check=False, timeout=60)
                finally:
                    for n in list((inspect(svc) or {}).get('NetworkSettings', {}).get('Networks', {}) or {}): sh('docker', 'network', 'disconnect', '-f', n, svc, check=False, timeout=60)
                sh('docker', 'rename', svc, svc + suffix, timeout=60)
        def restore(svc=svc):
            backup = svc + '-before-run-' + run.id
            if inspect(svc) is None and inspect(backup): sh('docker', 'rename', backup, svc, timeout=60)
            cur = inspect(svc)
            if cur and cur['Config']['Labels'].get('getoyi.run') is None and not cur['State']['Running']: sh('docker', 'start', svc, timeout=60)
        step(role + '_quarantine', quarantine); step(role + '_restore', restore)
        restorers.append((role, restore))
    if settle:
        time.sleep(STOP_S + 2)
        for role, restore in restorers: step(role + '_restore_after_settle', restore)
    # 4. Expire the Office execution window, so a quarantined Office can never be revived inside it.
    def expire():
        w = os.path.join(run.dir, 'office-window.json')
        if os.path.exists(w): os.rename(w, w + '.closed-' + stamp)
    step('window_expire', expire)
    # 5. Verify the end state.
    def verify():
        st = run.bridge('status'); out['ledger'] = st
        if st['run_enabled']: issues.append('ledger_not_disabled')
        r = inspect(run.relay)
        if r and (r['State']['Running'] or r['NetworkSettings']['Networks']): issues.append('relay_not_closed')
        if run_containers(run): issues.append('bounded_service_running')
        for n in run_containers(run, all_=True):
            x = inspect(n)
            if x and x['NetworkSettings']['Networks']: issues.append('quarantined_container_networked')
        try: before = json.load(open(os.path.join(run.dir, 'setup-env-before.json')))
        except OSError: before = {}
        for svc, role, off in ((c['backend'], 'backend', BACKEND_OFF), (c['office'], 'office', OFFICE_OFF)):
            cur = inspect(svc)
            if not cur or cur['Config']['Labels'].get('getoyi.run') or not cur['State']['Running'] or any(env_of(cur).get(k) != 'false' for k in off) \
               or (svc in before and env_hash(cur) != before[svc]):
                issues.append('setup_' + role + '_not_restored')
        if os.path.exists(os.path.join(run.dir, 'office-window.json')): issues.append('office_window_still_valid')
    step('verify', verify)
    out['issues'] = sorted(set(issues))
    return out, out['issues']

def stop(c, run_id):
    ignore_signals()  # close-down must not be interrupted half-way
    run = Run(c, run_id); stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
    out, issues = close_down(c, run, '-run-' + run.id + '-stopped-' + stamp, stamp)
    if issues: raise Refused('stop_incomplete', issues)
    out['setup_restored'] = True
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
        code = str(e); out = {'result': 'REFUSED', 'code': code if SAFE_ERR.match(code.replace(':rolled_back', '').replace(':rollback_incomplete', '')) else 'refused'}
        if e.issues: out['issues'] = e.issues
        print(json.dumps(out)); sys.exit(1)
    except Exception as e:
        print(json.dumps({'result': 'FAILED', 'type': type(e).__name__})); sys.exit(1)
