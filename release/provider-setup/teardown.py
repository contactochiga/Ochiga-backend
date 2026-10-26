from pathlib import Path
import subprocess,json,shutil,os,signal
p=Path(__file__).resolve().parent/'runtime'
if (p/'state.json').exists():
 s=json.loads((p/'state.json').read_text())
 ledgers=[p/'execution/run.sqlite',*p.glob('execution/runs/*/run.sqlite')]
 for ledger in ledgers:
  if not ledger.exists():continue
  import sqlite3
  try:
   with sqlite3.connect('file:'+str(ledger)+'?mode=ro',uri=True) as db:
    if db.execute('select count(*) from intents').fetchone()[0]:raise SystemExit('Execution evidence exists: preserve and reconcile before teardown')
  except sqlite3.Error:raise SystemExit('Execution state unavailable: preserve before teardown')
 for volume in s.get('execution_volumes',[]):
  if not volume.startswith('hardware-execution-ledger-'):raise SystemExit('Unrecognized execution volume: preserve')
  label=subprocess.run(['docker','volume','inspect','--format','{{index .Labels "getoyi.isolated.execution"}}',volume],capture_output=True,text=True)
  if label.returncode or label.stdout.strip()!='true':raise SystemExit('Execution volume unavailable: preserve')
  code="import sqlite3;db=sqlite3.connect('file:/run/execution/run.sqlite?mode=ro',uri=True);print(db.execute('select count(*) from intents').fetchone()[0])"
  result=subprocess.run(['docker','run','--rm','--network','none','--user','1000:1000','-v',volume+':/run/execution','getoyi-bounded-execution:local','python3','-c',code],capture_output=True,text=True)
  if result.returncode or result.stdout.strip()!='0':raise SystemExit('Execution volume evidence exists or unavailable: preserve')
 for db,table in [('backend','hardware_payment_attempts'),('office','hardware_payment_confirmations')]:
  r=subprocess.run(['docker','exec','hardware-setup-'+db+'-db','psql','-X','-Atq','-U','postgres','-d','postgres','-c','select count(*) from '+table],capture_output=True,text=True)
  if r.returncode!=0:raise SystemExit('Financial state unavailable: preserve services and inspect before teardown')
  if r.stdout.strip()!='0':raise SystemExit('Financial evidence exists: archive and reconcile before teardown')
 if (p/'tunnel.pid').exists():
  pid=int((p/'tunnel.pid').read_text());name=subprocess.run(['ps','-p',str(pid),'-o','command='],capture_output=True,text=True).stdout
  if 'cloudflared' in name and '18444' in name:os.kill(pid,signal.SIGTERM)
 r=subprocess.run(['docker','inspect','--format','{{index .Config.Labels "getoyi.isolated.provider"}}','hardware-provider-egress'],capture_output=True,text=True)
 if r.stdout.strip()=='true':subprocess.run(['docker','rm','-f','hardware-provider-egress'],capture_output=True)
 subprocess.run(['docker','network','rm','hardware-provider-egress-nat'],capture_output=True)
 for name in reversed(s['containers']):
  assert name.startswith('hardware-setup-')
  check=subprocess.run(['docker','inspect','--format','{{index .Config.Labels "getoyi.isolated.setup"}}',name],capture_output=True,text=True)
  if check.stdout.strip()=='true':subprocess.run(['docker','rm','-fv',name],capture_output=True)
 assert s['network']=='hardware-setup-private'
 subprocess.run(['docker','network','rm',s['network']],capture_output=True)
 subprocess.run(['docker','network','rm','hardware-setup-ingress'],capture_output=True)
 for volume in s.get('execution_volumes',[]):subprocess.run(['docker','volume','rm',volume],check=True,capture_output=True)
 shutil.rmtree(p)
print('Only recorded isolated setup resources removed')
