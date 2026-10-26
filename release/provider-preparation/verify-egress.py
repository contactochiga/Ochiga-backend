import subprocess,json
from pathlib import Path
checks=[]
def run(args):return subprocess.run(args,text=True,capture_output=True)
def check(name,ok):checks.append({'check':name,'pass':bool(ok)});print(('PASS ' if ok else 'FAIL ')+name,flush=True)
def node(container,code):return run(['docker','exec',container,'node','-e',code]).stdout.strip()
r=json.loads(node('hardware-setup-backend',"fetch('http://hardware-provider-egress:8080/probe').then(async r=>console.log(JSON.stringify({status:r.status,body:await r.json()})))"))
check('fixed provider TLS probe succeeds without financial API calls',r['status']==200 and r['body']['tls_verified'] and r['body']['financial_requests']==0)
for path,method in [('/transaction/initialize','POST'),('/refund','POST'),('/transaction/verify/hwo_fake','GET'),('/probe?host=getoyi.com','GET'),('/probe?host=production.supabase.co','GET'),('/probe?host=resident-wallet.invalid','GET'),('https://getoyi.com/','GET'),('/wallets/webhook','POST')]:
 code="fetch('http://hardware-provider-egress:8080/'+"+json.dumps(path.lstrip('/'))+",{method:"+json.dumps(method)+"}).then(r=>console.log(r.status))"
 check('relay rejects '+method+' '+path,node('hardware-setup-backend',code)=='403')
check('relay rejects credential forwarding',node('hardware-setup-backend',"fetch('http://hardware-provider-egress:8080/probe',{headers:{authorization:'Bearer SYNTHETIC'}}).then(r=>console.log(r.status))")=='403')
code="const h=require('http');const q=h.request({host:'hardware-provider-egress',port:8080,method:'CONNECT',path:'getoyi.com:443'});q.on('connect',(r,s)=>{console.log(r.statusCode);s.destroy()});q.end();"
check('CONNECT proxy tunnelling denied',node('hardware-setup-backend',code)=='403')
# Pin public test IPs directly: no DNS success/failure can masquerade as a firewall pass.
for port in [443,5432,587]:
 code="const n=require('net');const s=n.connect({host:'1.1.1.1',port:"+str(port)+"});s.setTimeout(1200);s.on('connect',()=>{console.log('OPEN');s.destroy()});s.on('error',()=>console.log('DENIED'));s.on('timeout',()=>{console.log('DENIED');s.destroy()});"
 check('relay firewall denies unrelated public IP port '+str(port),node('hardware-provider-egress',code)=='DENIED')
for service in ['backend','office','getoyi']:
 code="Promise.all(['https://getoyi.com','https://api.paystack.co','https://1.1.1.1'].map(async u=>{try{await fetch(u,{signal:AbortSignal.timeout(1200)});return false}catch{return true}})).then(x=>console.log(JSON.stringify(x)))"
 check(service+' retains direct external deny',node('hardware-setup-'+service,code)=='[true,true,true]')
status=run(['docker','exec','hardware-provider-egress','cat','/proc/1/status']).stdout
check('relay process has no effective capabilities','CapEff:\t0000000000000000' in status)
check('relay process runs as uid1000','Uid:\t1000\t1000\t1000\t1000' in status)
fw=run(['docker','exec','hardware-provider-egress','iptables','-S','OUTPUT']).stdout
check('kernel default-deny output firewall',fw.startswith('-P OUTPUT DROP'))
check('IPv6 default-deny output firewall',run(['docker','exec','hardware-provider-egress','ip6tables','-S','OUTPUT']).stdout.startswith('-P OUTPUT DROP'))
inspect=json.loads(run(['docker','inspect','hardware-provider-egress']).stdout)[0]
check('relay has no host credential mounts',not inspect['Mounts'] or all(m.get('Type')=='tmpfs' for m in inspect['Mounts']))
check('relay not publicly exposed',not inspect['HostConfig']['PortBindings'])
Path('/tmp/provider-egress-evidence.json').write_text(json.dumps({'checks':checks,'passed':sum(c['pass'] for c in checks),'failed':sum(not c['pass'] for c in checks)},indent=2)+'\n')
raise SystemExit(any(not c['pass'] for c in checks))
