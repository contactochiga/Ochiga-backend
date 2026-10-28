#!/usr/bin/env python3
"""Fingerprint-only check of the dedicated Paystack Test Mode credential. Never prints, logs or transmits the key.

Reports format checks and a SHA-256 fingerprint prefix (16 hex) of:
  - the injected runtime file (runtime/provider-test-key), and
  - the copy actually mounted read-only in hardware-setup-backend (hashed inside the container; nothing leaves it
    except the digest).
With --compare <16 hex>, compares against the fingerprint the owner computed locally from the Paystack dashboard
(see MERCHANT-FINGERPRINT-PROCEDURE.md). Makes no network request.
"""
import hashlib, json, os, re, stat, subprocess, sys

KEY = '/Users/ochigaidoko/getoyi-commerce/phase4/stage4e/environment-setup/runtime/provider-test-key'
FMT = re.compile(r'sk_test_[A-Za-z0-9_]{12,240}')

def fp(raw): return hashlib.sha256(raw.encode()).hexdigest()[:16]

def main():
    args = sys.argv[1:]
    want = args[args.index('--compare') + 1].lower() if '--compare' in args else None
    if want is not None and not re.fullmatch(r'[0-9a-f]{16}', want): raise SystemExit('compare value must be 16 hex characters')
    s = os.lstat(KEY)
    key = open(KEY).read().strip()
    out = {'file_regular': stat.S_ISREG(s.st_mode) and not stat.S_ISLNK(s.st_mode), 'file_mode': oct(s.st_mode & 0o777),
           'test_mode_key': key.startswith('sk_test_'), 'live_key': key.startswith('sk_live_'),
           'synthetic_placeholder': key.startswith('sk_test_SETUP_'), 'format_valid': bool(FMT.fullmatch(key)),
           'runtime_fingerprint': fp(key)}
    del key
    r = subprocess.run(['docker', 'exec', 'hardware-setup-backend', 'node', '-e',
        "const k=require('fs').readFileSync('/run/secrets/hardware-test-key','utf8').trim();"
        "console.log(require('crypto').createHash('sha256').update(k).digest('hex').slice(0,16))"], capture_output=True, text=True)
    out['backend_mounted_fingerprint'] = r.stdout.strip() if r.returncode == 0 else None
    out['backend_mount_matches_runtime'] = out['backend_mounted_fingerprint'] == out['runtime_fingerprint']
    if want is not None: out['matches_owner_dashboard_fingerprint'] = want == out['runtime_fingerprint']
    out['ok'] = (out['file_regular'] and out['file_mode'] == '0o600' and out['test_mode_key'] and not out['live_key']
                 and not out['synthetic_placeholder'] and out['format_valid'] and out['backend_mount_matches_runtime']
                 and out.get('matches_owner_dashboard_fingerprint', True))
    print(json.dumps(out, indent=1))
    sys.exit(0 if out['ok'] else 1)

if __name__ == '__main__':
    main()
