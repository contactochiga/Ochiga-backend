from pathlib import Path
import json,subprocess,ssl,urllib.request,urllib.error,time,hmac,hashlib,re
BASE=Path(__file__).resolve().parent;R=BASE/'runtime';s=json.loads((R/'state.json').read_text());results=[]
def check(name,ok,detail=None):
 results.append({'check':name,'pass':bool(ok),**({'detail':detail} if detail else {})});print(('PASS ' if ok else 'FAIL ')+name,flush=True)
def run(args):return subprocess.run(args,text=True,capture_output=True)
ctx=ssl.create_default_context(cafile=str(R/'tls/cert.pem'))
def request(url,body=None,headers={}):
 try:
  with urllib.request.urlopen(urllib.request.Request(url,data=body,headers=headers),context=ctx if url.startswith("https://localhost:") else ssl.create_default_context(),timeout=10) as r:return r.status,r.read()
 except urllib.error.HTTPError as e:return e.code,e.read()
net=json.loads(run(['docker','network','inspect','hardware-setup-private']).stdout)[0];check('application network is internal',net['Internal'])
for service in ['backend','office','getoyi']:
 name='hardware-setup-'+service;x=json.loads(run(['docker','inspect',name]).stdout)[0]
 check(service+' running',x['State']['Running']);check(service+' only on private network',set(x['NetworkSettings']['Networks'])=={'hardware-setup-private'})
 check(service+' no production environment mount',all(not (m['Source'].endswith('.env') or '/.codex/' in m['Source'] or '/.vercel/' in m['Source']) for m in x['Mounts']))
 names={v.split('=',1)[0] for v in x['Config']['Env']};check(service+' no wallet or notification credentials',not names.intersection({'PAYSTACK_SECRET_KEY','PAYSTACK_SECRECT_KEY','RESEND_API_KEY','SMTP_PASSWORD','TWILIO_AUTH_TOKEN'}))
 probe="""Promise.all(['https://getoyi.com','https://api.paystack.co','https://1.1.1.1'].map(async u=>{try{await fetch(u,{signal:AbortSignal.timeout(1800)});return false;}catch{return true;}})).then(x=>console.log(JSON.stringify(x)))"""
 rr=run(['docker','exec',name,'node','-e',probe]);check(service+' production/provider/public-IP egress denied',rr.stdout.strip()=='[true,true,true]')
 probe="const net=require('net');const s=net.connect({host:'host.docker.internal',port:443});s.setTimeout(1500);s.on('connect',()=>{console.log('OPEN');s.destroy()});s.on('error',()=>console.log('DENIED'));s.on('timeout',()=>{console.log('DENIED');s.destroy()});"
 rr=run(['docker','exec',name,'node','-e',probe]);check(service+' host HTTPS access denied',rr.stdout.strip()=='DENIED')
check('GetOyi HTTPS hardware remains static',request('https://localhost:18443/hardware')[0]==200)
check('Office HTTPS health',request('https://localhost:18445/healthz')[0]==200)
base='http://127.0.0.1:18444'
for path in ['/','/healthz','/wallets/webhook','/hardware-payments/initialize','/api/commerce/payments/operations','/hardware-payments/webhook?extra=1']:
 check('ingress denies '+path,request(base+path,b'{}',{'Content-Type':'application/json'})[0]==404)
check('webhook GET denied',request(base+'/hardware-payments/webhook')[0]==404)
check('webhook invalid signature denied',request(base+'/hardware-payments/webhook',b'{}',{'Content-Type':'application/json'})[0]==401)
be=dict(line.split('=',1) for line in (R/'backend.env').read_text().splitlines())
payload=b'{"event":"setup.only","data":{"reference":"hwo_00000000000000000000000000000000"}}'
signature=hmac.new(be['HARDWARE_PAYSTACK_SECRET_KEY'].encode(),payload,hashlib.sha512).hexdigest()
check('synthetic valid signature cannot process',request(base+'/hardware-payments/webhook',payload,{'Content-Type':'application/json','x-paystack-signature':signature})[0]==503)
body=json.dumps({'action':'approved-refunds'}).encode();code,data=request('https://localhost:18445/api/commerce/payments/operations',body,{'Content-Type':'application/json','x-api-key':s['keys']['operations']})
check('Office financial read scope works with empty synthetic ledger',code==200 and json.loads(data)=={'approvals':[]})
code,_=request('https://localhost:18445/api/commerce/payments/confirm',b'{}',{'Content-Type':'application/json','x-api-key':s['keys']['operations']});check('financial key cannot confirm payments',code==403)
for db in ['office','backend']:
 prefix=['docker','exec','hardware-setup-'+db+'-db','psql','-X','-Atq','-U','postgres','-d','postgres','-c']
 table='hardware_payment_attempts' if db=='backend' else 'hardware_payment_confirmations'
 check(db+' no payment records',run(prefix+['select count(*) from '+table]).stdout.strip()=='0')
 if db=='backend':check('Backend has no resident wallet relations',run(prefix+["select count(*) from pg_tables where schemaname='public' and tablename ilike '%wallet%'"]).stdout.strip()=='0')
 else:check('Office contains only labelled synthetic CRM contact',run(prefix+["select count(*)=1 and bool_and(email='setup@example.invalid') from crm_contacts"]).stdout.strip()=='t')
for name in ['backend','office','getoyi']:
 command=['docker','run','--rm','--network','none','--env-file',str(R/(name+'.env')),'-e','PAYSTACK_SECRET_KEY=forbidden','-v',str(BASE/'guard.cjs')+':/guard.cjs:ro','getoyi-hardware-setup:local','node']
 command+=['/app/backend/dist/commerce/hardwareSetupServer.js'] if name=='backend' else ['--require','/guard.cjs','-e','process.exit(0)']
 rr=run(command);check(name+' startup rejects wallet credential',rr.returncode!=0)
probe="Promise.all(['/wallets/webhook','/wallets/initialize'].map(p=>fetch('http://127.0.0.1:3000'+p,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.status))).then(x=>console.log(JSON.stringify(x)))"
check('wallet routes absent inside Backend too',run(['docker','exec','hardware-setup-backend','node','-e',probe]).stdout.strip()=='[404,404]')
probe="fetch('http://office-data:3000/rest/v1/hardware_orders?select=id',{headers:{authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY}}).then(r=>console.log(r.status))"
check('Backend credential rejected by Office DB',run(['docker','exec','hardware-setup-backend','node','-e',probe]).stdout.strip()=='401')
probe="const {createClient}=require('/app/backend/node_modules/@supabase/supabase-js');createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY).from('hardware_payment_attempts').select('reference').then(r=>console.log(!r.error&&r.data.length===0))"
check('Backend reads its empty local ledger',run(['docker','exec','hardware-setup-backend','node','-e',probe]).stdout.strip()=='true')
probe="fetch(process.env.OCHIGA_OFFICE_CHECKOUT_URL+'/api/commerce/checkout/quote',{method:'POST',headers:{'content-type':'application/json','x-api-key':process.env.OCHIGA_OFFICE_CHECKOUT_KEY},body:JSON.stringify({lines:[]})}).then(r=>console.log(r.status))"
check('Frontend reaches scoped Office validation',run(['docker','exec','hardware-setup-getoyi','node','-e',probe]).stdout.strip()=='400')
probe="fetch('https://getoyi.com',{signal:AbortSignal.timeout(1500)}).then(()=>console.log('OPEN')).catch(()=>console.log('DENIED'))"
check('gateway public egress denied with NAT disabled',run(['docker','exec','hardware-setup-gateway','node','-e',probe]).stdout.strip()=='DENIED')
check('real provider credential not injected',(R/'provider-test-key').exists()==False)
log=(R/'tunnel.log').read_text();urls=re.findall(r'https://[a-z0-9-]+\.trycloudflare\.com',log)
if urls:
 public=urls[0];(BASE/'webhook-destination.txt').write_text(public+'/hardware-payments/webhook\n')
 for path,expected in [('/wallets/webhook',404),('/hardware-payments/initialize',404),('/hardware-payments/webhook',401)]:
  try:code,_=request(public+path,b'{}',{'Content-Type':'application/json'});check('public HTTPS '+path,code==expected,{'status':code})
  except Exception:check('public HTTPS '+path,False,'unreachable')
else:check('public HTTPS tunnel assigned',False)
(BASE/'verification.json').write_text(json.dumps({'checks':results,'passed':sum(x['pass'] for x in results),'failed':sum(not x['pass'] for x in results)},indent=2)+'\n')
raise SystemExit(any(not x['pass'] for x in results))
