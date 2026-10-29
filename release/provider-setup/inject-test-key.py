from pathlib import Path
import getpass,os
root=Path(__file__).resolve().parent/'runtime'
if not (root/'state.json').exists():raise SystemExit('Create and verify isolated setup first')
value=getpass.getpass('Dedicated Paystack TEST key (hidden; stored only, not activated): ').strip()
if not value.startswith('sk_test_') or value.startswith('sk_test_SETUP_') or not 20<=len(value)<=256 or any(c.isspace() for c in value):raise SystemExit('Dedicated test key required')
path=root/'provider-test-key'
fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:f.write(value)
print('Test credential stored securely; NOT loaded into services. Transactions remain disabled.')
