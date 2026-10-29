"""Create fresh isolated fixtures and a DISABLED run. Never calls Paystack or arms execution."""
import os,sys,json,secrets,subprocess,shutil
from pathlib import Path
from executor import Executor
from bridge import main
os.umask(0o077)
BASE=Path('/Users/ochigaidoko/getoyi-commerce/phase4/stage4e/environment-setup')
if sys.argv[1:]!=['--prepare']:raise SystemExit('Use --prepare; no execution or authorization capability')
run_id=secrets.token_hex(6);root=BASE/'runtime/execution/runs'/run_id;root.mkdir(parents=True,mode=0o700)
# Fixed known disposable target; seed script additionally checks Docker setup label.
seed=Path(__file__).resolve().parent.parent/'provider-setup/prepare-commerce-fixture.py'
shutil.copy(seed,BASE/'prepare-commerce-fixture.py')
r=subprocess.run([sys.executable,str(BASE/'prepare-commerce-fixture.py')],env={**os.environ,'HARDWARE_FIXTURE_RUN_ID':run_id},capture_output=True)
if r.returncode:raise SystemExit('fresh_fixture_preparation_failed; preserve local evidence and inspect')
orders=json.loads((BASE/('runtime/scenario-orders-'+run_id+'.json')).read_text())
manifest=json.loads((Path(__file__).resolve().parent.parent/'provider-preparation/run-manifest.json').read_text())
ledger=root/'run.sqlite';e=Executor(str(ledger),manifest);digest=e.digest;e.close()
plan=[dict(reference='hwo_'+v['order_id'].replace('-',''),scenario=k,amount=v['amount_kobo']) for k,v in orders.items()]
q=dict(database=str(ledger),manifest=manifest,mode='real-provider',action='prepare',plan=plan)
plan_hash=main(q)['plan_sha256']
config=dict(database='/run/execution/run.sqlite',manifest=manifest,mode='real-provider',planSha256=plan_hash,python='python3')
(root/'config.json').write_text(json.dumps(config,indent=2));(root/'scenario-orders.json').write_text(json.dumps(orders,indent=2))
(root/'authorization-required.json').write_text(json.dumps(dict(manifest_sha256=digest,plan_sha256=plan_hash,authorized=False,environment='test',evidence='real-provider'),indent=2))
volume='hardware-execution-ledger-'+run_id
subprocess.run(['docker','volume','create','--label','getoyi.isolated.execution=true',volume],check=True,stdout=subprocess.DEVNULL)
copy_code="import shutil,os;shutil.copytree('/seed','/run/execution',dirs_exist_ok=True);[(os.chown(p,1000,1000),os.chmod(p,0o700 if os.path.isdir(p) else 0o600)) for p in ['/run/execution']+[os.path.join(d,n) for d,ds,fs in os.walk('/run/execution') for n in ds+fs]]"
subprocess.run(['docker','run','--rm','--network','none','-v',str(root)+':/seed:ro','-v',volume+':/run/execution','getoyi-bounded-execution:local','python3','-c',copy_code],check=True)
state_path=BASE/'runtime/state.json';state=json.loads(state_path.read_text())
secret_dir=BASE/'runtime/execution/service-secrets'/run_id;secret_dir.mkdir(parents=True,mode=0o700)
for name,source in [('isolated-backend-key','backend'),('isolated-checkout-key','checkout')]:
 (secret_dir/name).write_text(state['keys'][source]);os.chmod(secret_dir/name,0o600)
state.setdefault('execution_volumes',[]).append(volume);state_path.write_text(json.dumps(state));os.chmod(state_path,0o600)
print(json.dumps(dict(run_id=run_id,ledger_volume=volume,manifest_sha256=digest,plan_sha256=plan_hash,authorized=False,provider_calls=0)))
