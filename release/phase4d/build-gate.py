from pathlib import Path
import json,hashlib
repo=Path(__file__).resolve().parents[2];root=Path(__file__).resolve().parent
PINS={'supabase/migrations/20261026094951_hardware_payment_attempts.sql': '425481d6c6092f42623c9233a0971290da26b391b8545833a450f3fd547def52', 'release/phase4d/payment-reviewed.json': '7b722a3ce942eccd77d20f1fab28621274ebcd561d7b14bccfba4975389a1a21', 'release/phase4d/payment-shape.sql': '996ace9de868ff0d4bcbf6cd221e332b18b2e9c0dc095af6d7d3bafe9e1c3649'}
for name,digest in PINS.items():
 assert hashlib.sha256((repo/name).read_bytes()).hexdigest()==digest,'Review required: '+name
shape=(root/'payment-shape.sql').read_text().strip().rstrip(';');data=json.dumps(json.loads((root/'payment-reviewed.json').read_text()),separators=(',',':'))
(root/'security-gate.sql').write_text(f"with shape as ({shape}) select case when jsonb_build_object=$reviewed${data}$reviewed$::jsonb then 'PASS' else 'FAIL' end as hardware_payment_security from shape;\n")
