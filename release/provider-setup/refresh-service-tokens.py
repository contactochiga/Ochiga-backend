#!/usr/bin/env python3
"""Refresh the isolated setup's expiring service-role JWTs (local isolated environment only).

`setup.py` mints HS256 `service_role` tokens (iss `isolated-setup`) valid for 24 hours. Docker cannot change a running
container's environment, so a refresh recreates ONLY `hardware-setup-office` and `hardware-setup-backend` with an
identical configuration except `SUPABASE_SERVICE_ROLE_KEY`. Old containers are kept as stopped, labelled backups.

Never prints, logs or passes a token on a command line (env file 0600, deleted). Uses only the isolated per-database
secret from runtime/state.json, and refuses unless it equals that database's PostgREST secret and signed the current
token. Refuses unless every payment/refund switch is false, bindings are isolated, no wallet or live credential is
present, the private network is internal and no financial relay is running. Verifies configuration parity after
recreation; any difference or startup failure rolls back to the backup automatically. Default is a dry run.

Usage: refresh-service-tokens.py [--apply] [--ttl-hours N]   (N: 1..24, default 6)
"""
import base64, hashlib, hmac, json, os, subprocess, sys, tempfile, time

RUNTIME = '/Users/ochigaidoko/getoyi-commerce/phase4/stage4e/environment-setup/runtime'
NET = 'hardware-setup-private'
TARGETS = [  # Backend first: Office calls it.
    {'name': 'hardware-setup-backend', 'api': 'hardware-setup-backend-api', 'kind': 'backend', 'url': 'http://backend-rest:3000',
     'off': ['HARDWARE_PAYMENT_INITIALIZATION_ENABLED', 'HARDWARE_PAYMENT_PROCESSING_ENABLED', 'HARDWARE_FINANCIAL_RECOVERY_ENABLED', 'HARDWARE_REFUNDS_ENABLED']},
    {'name': 'hardware-setup-office', 'api': 'hardware-setup-office-api', 'kind': 'office', 'url': 'http://office-data:3000',
     'off': ['OFFICE_HARDWARE_PAYMENTS_ENABLED', 'OFFICE_HARDWARE_PAYMENT_PROCESSING_ENABLED']},
]
TOKEN = 'SUPABASE_SERVICE_ROLE_KEY'
FORBIDDEN = ['PAYSTACK_SECRET_KEY', 'PAYSTACK_SECRECT_KEY', 'DATABASE_URL', 'RESEND_API_KEY', 'SMTP_HOST']

class Refused(RuntimeError): pass

def sh(*a, check=True, input=None):
    r = subprocess.run(list(a), capture_output=True, text=True, input=input, timeout=120)
    if check and r.returncode: raise Refused(f'docker_command_failed:{a[1]}')
    return r

def inspect(name): return json.loads(sh('docker', 'inspect', name).stdout)[0]
def env(c): return dict(e.split('=', 1) for e in c['Config']['Env'])
b64 = lambda raw: base64.urlsafe_b64encode(raw).decode().rstrip('=')
def unb64(s): return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))

def require(cond, code):
    if not cond: raise Refused(code)

def mint(secret, ttl):
    now = int(time.time())
    body = b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}, separators=(',', ':')).encode()) + '.' + \
        b64(json.dumps({'role': 'service_role', 'iss': 'isolated-setup', 'iat': now, 'exp': now + ttl}, separators=(',', ':')).encode())
    return body + '.' + b64(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest()), now + ttl

def claims(token): return json.loads(unb64(token.split('.')[1]))

def signed_by(token, secret):
    h, p, s = token.split('.')
    return hmac.compare_digest(b64(hmac.new(secret.encode(), (h + '.' + p).encode(), hashlib.sha256).digest()), s)

def parity(c):
    """Every security- and binding-relevant field except the token."""
    h, cfg = c['HostConfig'], c['Config']
    nets = {k: sorted(a for a in (v.get('Aliases') or []) if a != c['Id'][:12]) for k, v in c['NetworkSettings']['Networks'].items()}
    keys = ['Binds', 'CapAdd', 'CapDrop', 'SecurityOpt', 'ReadonlyRootfs', 'Tmpfs', 'RestartPolicy', 'PortBindings', 'NetworkMode',
            'Privileged', 'Memory', 'NanoCpus', 'PidsLimit', 'Init', 'ExtraHosts', 'Dns', 'GroupAdd', 'Devices', 'AutoRemove']
    return {'image': cfg['Image'], 'cmd': cfg['Cmd'], 'entrypoint': cfg['Entrypoint'], 'user': cfg['User'], 'workdir': cfg['WorkingDir'],
            'labels': cfg['Labels'], 'env': sorted(e for e in cfg['Env'] if not e.startswith(TOKEN + '=')), 'networks': nets,
            'host': {k: h.get(k) for k in keys}}

def preflight(state):
    require(oct(os.stat(RUNTIME + '/state.json').st_mode & 0o777) == '0o600', 'state_file_mode')
    require(json.loads(sh('docker', 'network', 'inspect', NET).stdout)[0]['Internal'] is True, 'private_network_not_internal')
    running = sh('docker', 'ps', '--format', '{{.Names}}').stdout.split()
    require(not [n for n in running if n.startswith('hardware-provider-financial')], 'financial_relay_running')
    plan = []
    for t in TARGETS:
        c, api = inspect(t['name']), inspect(t['api'])
        e, secret = env(c), state['keys'][t['kind'] + '-jwt']
        require(c['Config']['Labels'].get('getoyi.isolated.setup') == 'true' and c['State']['Running'], 'target_not_isolated_or_running')
        require(list(c['NetworkSettings']['Networks']) == [NET] and c['HostConfig']['NetworkMode'] == NET, 'target_network_not_private_only')
        require(e.get('SUPABASE_URL') == t['url'], 'isolated_database_binding_required')
        require(all(e.get(k) == 'false' for k in t['off']), 'payment_switch_not_disabled')
        require(not any(e.get(k) for k in FORBIDDEN) and not any('sk_live_' in v for v in e.values()), 'forbidden_or_live_credential')
        if t['kind'] == 'backend': require(e.get('HARDWARE_PAYSTACK_SECRET_KEY', '').startswith('sk_test_SETUP_'), 'synthetic_payment_factory_required')
        require(hmac.compare_digest(secret, env(api)['PGRST_JWT_SECRET']), 'secret_not_isolated_database_secret')
        cur = e.get(TOKEN, '')
        require(cur.count('.') == 2 and signed_by(cur, secret), 'current_token_not_from_isolated_secret')
        cl = claims(cur)
        require(cl.get('role') == 'service_role' and cl.get('iss') == 'isolated-setup', 'current_token_claims_unexpected')
        plan.append({**t, 'container': c, 'secret': secret, 'current_exp': cl.get('exp')})
    return plan

def run_args(c, envfile):
    cfg, h = c['Config'], c['HostConfig']
    image_ep = json.loads(sh('docker', 'image', 'inspect', cfg['Image']).stdout)[0]['Config'].get('Entrypoint')
    a = ['docker', 'run', '-d', '--name', c['Name'].lstrip('/'), '--env-file', envfile, '--network', h['NetworkMode'],
         '--restart', h['RestartPolicy']['Name'] or 'no']
    for k, v in (cfg['Labels'] or {}).items(): a += ['--label', f'{k}={v}']
    for al in (c['NetworkSettings']['Networks'][h['NetworkMode']].get('Aliases') or []):
        if al != c['Id'][:12]: a += ['--network-alias', al]
    for b in h.get('Binds') or []: a += ['-v', b]
    for x in h.get('CapAdd') or []: a += ['--cap-add', x]
    for x in h.get('CapDrop') or []: a += ['--cap-drop', x]
    for x in h.get('SecurityOpt') or []: a += ['--security-opt', x]
    for k, v in (h.get('Tmpfs') or {}).items(): a += ['--tmpfs', f'{k}:{v}' if v else k]
    for p, bs in (h.get('PortBindings') or {}).items():
        for b in bs: a += ['-p', f"{b['HostIp']+':' if b.get('HostIp') else ''}{b['HostPort']}:{p}"]
    if h.get('ReadonlyRootfs'): a.append('--read-only')
    if cfg.get('User'): a += ['--user', cfg['User']]
    if cfg.get('WorkingDir'): a += ['-w', cfg['WorkingDir']]
    require(not h.get('Privileged') and not h.get('Devices') and not h.get('ExtraHosts'), 'unsupported_or_unsafe_host_config')
    cmd = list(cfg['Cmd'] or [])
    if cfg.get('Entrypoint') != image_ep:
        ep = cfg.get('Entrypoint') or ['']
        a += ['--entrypoint', ep[0]]; cmd = ep[1:] + cmd
    return a + [cfg['Image']] + cmd

def refresh(t, ttl, state, stamp):
    c, name = t['container'], t['name']
    before = parity(c)
    token, exp = mint(t['secret'], ttl)
    e = [x for x in c['Config']['Env'] if not x.startswith(TOKEN + '=')] + [f'{TOKEN}={token}']
    fd, envfile = tempfile.mkstemp(prefix='.refresh-', dir=RUNTIME)
    backup = f'{name}-before-token-refresh-{stamp}'
    try:
        with os.fdopen(fd, 'w') as f: f.write('\n'.join(e) + '\n')
        os.chmod(envfile, 0o600)
        args = run_args(c, envfile)
        sh('docker', 'stop', '-t', '10', name); sh('docker', 'rename', name, backup)
        try:
            sh(*args)
            time.sleep(4)
            new = inspect(name)
            require(new['State']['Running'], 'recreated_container_not_running')
            require(parity(new) == before, 'configuration_parity_failed')
            ne = env(new)[TOKEN]
            require(signed_by(ne, t['secret']) and claims(ne)['exp'] == exp, 'new_token_not_applied')
        except Exception:
            sh('docker', 'rm', '-f', name, check=False); sh('docker', 'rename', backup, name, check=False); sh('docker', 'start', name, check=False)
            raise
    finally:
        try: os.unlink(envfile)
        except FileNotFoundError: pass
    state.setdefault('containers', []).append(backup)  # teardown inventory
    state.setdefault('token_refreshes', []).append({'container': name, 'backup': backup, 'exp': exp, 'at': int(time.time())})
    return {'container': name, 'backup': backup, 'previous_exp_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(t['current_exp'])),
            'new_exp_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(exp)), 'configuration_parity': True}

def main():
    argv = sys.argv[1:]
    apply = '--apply' in argv
    ttl_h = int(argv[argv.index('--ttl-hours') + 1]) if '--ttl-hours' in argv else 6
    require(1 <= ttl_h <= 24, 'ttl_hours_out_of_range')
    state = json.load(open(RUNTIME + '/state.json'))
    plan = preflight(state)
    if not apply:
        print(json.dumps({'mode': 'dry-run', 'preflight': 'PASS', 'would_recreate': [p['name'] for p in plan],
                          'current_exp_utc': {p['name']: time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(p['current_exp'])) for p in plan},
                          'ttl_hours': ttl_h}, indent=1)); return
    stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
    results = []
    for t in plan:
        results.append(refresh(t, ttl_h * 3600, state, stamp))
        p = RUNTIME + '/state.json.tmp'
        with open(os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as f: json.dump(state, f)
        os.replace(p, RUNTIME + '/state.json')
    print(json.dumps({'mode': 'applied', 'ttl_hours': ttl_h, 'results': results}, indent=1))

if __name__ == '__main__':
    try: main()
    except Refused as e:
        print(json.dumps({'result': 'REFUSED', 'code': str(e)})); sys.exit(1)
    except Exception as e:
        print(json.dumps({'result': 'FAILED', 'type': type(e).__name__})); sys.exit(1)
