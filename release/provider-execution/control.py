"""Local control inside the isolated executor container. No provider requests."""
import json,sys
from pathlib import Path
from bridge import main
p=Path('/run/execution');c=json.loads((p/'config.json').read_text());q=dict(database=c['database'],manifest=c['manifest'],mode=c['mode'],plan_sha256=c['planSha256'])
if sys.argv[1:]==['--disable']:print(json.dumps(main({**q,'action':'disable'})))
elif sys.argv[1:]==['--arm-approved-run']:
 # File must be supplied only after separate human authorization, never synthesized by this tool.
 a=json.loads((p/'authorization.json').read_text());print(json.dumps(main({**q,'action':'arm','approval':a})))
else:raise SystemExit('No default action; explicit disable or separately approved arming required')
