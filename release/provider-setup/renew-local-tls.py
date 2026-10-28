#!/usr/bin/env python3
"""Renew the isolated setup's local TLS certificate (local isolated environment only).

`setup.py` issues a self-signed localhost/office.hardware.test certificate valid for 2 days. Office, Backend and GetOyi
bind-mount runtime/tls/cert.pem as a single file and trust it through NODE_EXTRA_CA_CERTS, which Node reads at startup;
the gateway serves it. Renewal re-issues the certificate with the SAME key, subject and SANs, rewrites cert.pem in place
(same inode, so single-file bind mounts see it), then restarts only those four labelled setup containers. `docker
restart` keeps every container setting, including the service tokens. No key, token or credential is printed.

Refuses unless the private network is internal and no financial relay is running. Default is a dry run.

Usage: renew-local-tls.py [--apply] [--days N]   (N: 1..7, default 2)
"""
import json, os, subprocess, sys, tempfile, time

RUNTIME = '/Users/ochigaidoko/getoyi-commerce/phase4/stage4e/environment-setup/runtime'
CERT, KEY = RUNTIME + '/tls/cert.pem', RUNTIME + '/tls/key.pem'
NET = 'hardware-setup-private'
TARGETS = ['hardware-setup-gateway', 'hardware-setup-backend', 'hardware-setup-office', 'hardware-setup-getoyi']  # gateway first

class Refused(RuntimeError): pass

def sh(*a, check=True):
    r = subprocess.run(list(a), capture_output=True, text=True, timeout=120)
    if check and r.returncode: raise Refused(f'command_failed:{a[0]}:{a[1]}')
    return r

def require(cond, code):
    if not cond: raise Refused(code)

def cert_info(path):
    out = sh('openssl', 'x509', '-in', path, '-noout', '-enddate', '-subject', '-fingerprint', '-sha256', '-ext', 'subjectAltName').stdout
    return {'not_after': out.split('notAfter=')[1].split('\n')[0], 'subject': out.split('subject=')[1].split('\n')[0].strip(),
            'sha256': out.split('Fingerprint=')[1].split('\n')[0].replace(':', '').lower()[:16],
            'san': out.split('Alternative Name:')[1].strip().split('\n')[0].strip()}

def preflight():
    require(json.loads(sh('docker', 'network', 'inspect', NET).stdout)[0]['Internal'] is True, 'private_network_not_internal')
    running = sh('docker', 'ps', '--format', '{{.Names}}').stdout.split()
    require(not [n for n in running if n.startswith('hardware-provider-financial')], 'financial_relay_running')
    for t in TARGETS:
        c = json.loads(sh('docker', 'inspect', t).stdout)[0]
        require(c['Config']['Labels'].get('getoyi.isolated.setup') == 'true' and c['State']['Running'], 'target_not_isolated_or_running')
    require(oct(os.stat(KEY).st_mode & 0o777) == '0o600', 'key_file_mode')
    info = cert_info(CERT)
    require(info['subject'] == 'CN=localhost' and info['san'] == 'DNS:localhost, DNS:office.hardware.test', 'unexpected_certificate_identity')
    return info

def main():
    argv = sys.argv[1:]
    apply, days = '--apply' in argv, int(argv[argv.index('--days') + 1]) if '--days' in argv else 2
    require(1 <= days <= 7, 'days_out_of_range')
    before = preflight()
    if not apply:
        print(json.dumps({'mode': 'dry-run', 'preflight': 'PASS', 'current': before, 'would_restart': TARGETS, 'days': days}, indent=1)); return
    inode = os.stat(CERT).st_ino
    fd, tmp = tempfile.mkstemp(prefix='.cert-', dir=RUNTIME + '/tls'); os.close(fd)
    try:
        sh('openssl', 'req', '-x509', '-new', '-key', KEY, '-out', tmp, '-days', str(days), '-subj', '/CN=localhost',
           '-addext', 'subjectAltName=DNS:localhost,DNS:office.hardware.test')
        new = cert_info(tmp)
        require(new['subject'] == before['subject'] and new['san'] == before['san'], 'renewed_identity_mismatch')
        data = open(tmp, 'rb').read()
    finally:
        os.unlink(tmp)
    with open(CERT, 'r+b') as f: f.seek(0); f.write(data); f.truncate()  # in place: bind mounts keep the inode
    require(os.stat(CERT).st_ino == inode, 'certificate_inode_changed')
    for t in TARGETS:
        sh('docker', 'restart', '-t', '10', t)
    time.sleep(4)
    seen = {}
    for t in TARGETS:
        c = json.loads(sh('docker', 'inspect', t).stdout)[0]
        require(c['State']['Running'], 'restarted_container_not_running')
        path = '/tls/cert.pem'
        seen[t] = __import__('hashlib').sha256(sh('docker', 'exec', t, 'cat', path).stdout.encode()).hexdigest() == \
            __import__('hashlib').sha256(data).hexdigest()
    require(all(seen.values()), 'container_does_not_see_renewed_certificate')
    print(json.dumps({'mode': 'applied', 'previous_not_after': before['not_after'], 'new': new, 'restarted': TARGETS,
                      'containers_see_renewed_certificate': seen}, indent=1))

if __name__ == '__main__':
    try: main()
    except Refused as e:
        print(json.dumps({'result': 'REFUSED', 'code': str(e)})); sys.exit(1)
    except Exception as e:
        print(json.dumps({'result': 'FAILED', 'type': type(e).__name__})); sys.exit(1)
