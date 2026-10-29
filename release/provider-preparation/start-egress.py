from pathlib import Path
import subprocess,json
root=Path(__file__).resolve().parent
check=subprocess.run(['docker','network','inspect','hardware-setup-private'],capture_output=True,text=True,check=True)
assert json.loads(check.stdout)[0]['Internal'],'Private network required'
if subprocess.run(['docker','inspect','hardware-provider-egress'],capture_output=True).returncode==0:raise SystemExit('Existing relay retained; inspect it rather than replace silently')
subprocess.run(['docker','build','-t','getoyi-provider-egress:preparation',str(root)],check=True)
subprocess.run(['docker','network','create','--label','getoyi.isolated.provider=true','hardware-provider-egress-nat'],check=True)
subprocess.run(['docker','create','--name','hardware-provider-egress','--label','getoyi.isolated.provider=true','--network','hardware-setup-private','--cap-drop','ALL','--cap-add','NET_ADMIN','--cap-add','SETUID','--cap-add','SETGID','--security-opt','no-new-privileges','--read-only','--tmpfs','/run:rw,nosuid,size=1m','getoyi-provider-egress:preparation'],check=True)
subprocess.run(['docker','network','connect','hardware-provider-egress-nat','hardware-provider-egress'],check=True)
subprocess.run(['docker','start','hardware-provider-egress'],check=True)
