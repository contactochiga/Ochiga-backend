from pathlib import Path
import subprocess,json,secrets,base64,hmac,hashlib,time,os
BASE=Path(__file__).resolve().parent
RUN=BASE/'runtime';RUN.mkdir(mode=0o700,exist_ok=True);os.chmod(RUN,0o700)
NET='hardware-setup-private';IMAGE='getoyi-hardware-setup:local';PG='public.ecr.aws/supabase/postgres:17.6.1.131';REST='public.ecr.aws/supabase/postgrest:v14.12'
O=Path('/Users/ochigaidoko/getoyi-work/office-phase4e');B=Path('/Users/ochigaidoko/getoyi-work/backend-phase4e')
def cmd(args,input=None,check=True):
 r=subprocess.run(args,input=input,text=True,capture_output=True)
 if check and r.returncode:raise RuntimeError('isolated command failed: '+args[0]+' '+r.stderr[:160])
 return r
if (RUN/'state.json').exists():raise SystemExit('Existing setup must be explicitly torn down before creating another.')
state={'containers':[],'network':NET,'created':time.time(),'keys':{k:secrets.token_hex(32) for k in ['office-jwt','backend-jwt','office-pw','backend-pw','full','session','checkout','confirm','operations','backend','catalogue','guest']}}
def save():
 p=RUN/'state.json';p.write_text(json.dumps(state));os.chmod(p,0o600)
def start(name,args):
 cmd(['docker','run','-d','--name',name,'--label','getoyi.isolated.setup=true','--network',NET]+args);state['containers'].append(name);save()
def sql(db,text,stop=True):return cmd(['docker','exec','-i','hardware-setup-'+db+'-db','psql','-X','-Atq','-U','postgres','-d','postgres','-v','ON_ERROR_STOP='+('1' if stop else '0')],text,stop)
def jwt(kind):
 enc=lambda o:base64.urlsafe_b64encode(json.dumps(o,separators=(',',':')).encode()).decode().rstrip('=')
 body=enc({'alg':'HS256','typ':'JWT'})+'.'+enc({'role':'service_role','iss':'isolated-setup','exp':int(time.time())+86400})
 return body+'.'+base64.urlsafe_b64encode(hmac.new(state['keys'][kind+'-jwt'].encode(),body.encode(),hashlib.sha256).digest()).decode().rstrip('=')
def envfile(name,data):
 p=RUN/(name+'.env');p.write_text('\n'.join(k+'='+v for k,v in data.items())+'\n');os.chmod(p,0o600);return str(p)
cmd(['docker','network','create','--internal',NET]);save()
for db in ['office','backend']:
 start('hardware-setup-'+db+'-db',['-e','POSTGRES_PASSWORD='+state['keys'][db+'-pw'],PG])
 for i in range(100):
  r=cmd(['docker','exec','hardware-setup-'+db+'-db','psql','-X','-Atq','-U','postgres','-h','127.0.0.1','-c',"select count(*) from pg_roles where rolname in ('anon','authenticated','service_role','authenticator')"],check=False)
  if r.stdout.strip()=='4':break
  time.sleep(.5)
 else:raise RuntimeError('database_not_ready')
 cmd(['docker','exec','hardware-setup-'+db+'-db','psql','-X','-U','supabase_admin','-d','postgres','-h','127.0.0.1','-c',"alter role authenticator with password '"+state['keys'][db+'-pw']+"'"])
print('Fresh separate databases ready',flush=True)
# Schema only: no dump or production data is read.
schema=(O/'db/lead-agents-schema.sql').read_text();sql('office',schema,False);r=sql('office',schema,False)
if 'ERROR' in r.stderr:raise RuntimeError('office_bootstrap_failed')
foundation='20261102_catalogue_foundation.sql'
follows=sorted(x for x in (O/'db').glob('202611*_catalogue_*.sql') if x.name!=foundation)
exclude={foundation,'20261107_hardware_orders.sql','20261108_hardware_checkout.sql'}|{p.name for p in follows}
for f in sorted((O/'db').glob('2026*.sql')):
 if f.name not in exclude:sql('office',f.read_text())
hardening="""revoke all on all tables in schema public from public,anon,authenticated;revoke all on all sequences in schema public from public,anon,authenticated;revoke all on all functions in schema public from public,anon,authenticated;
do $$declare r record;begin for r in select oid::regclass rel from pg_class where relnamespace='public'::regnamespace and relkind in ('r','p') loop execute format('alter table %s enable row level security',r.rel);end loop;end$$;
grant usage on schema public to service_role,authenticator,postgres;revoke usage on schema public from public,anon,authenticated;
alter default privileges in schema public revoke all on tables from anon,authenticated;alter default privileges in schema public revoke all on functions from anon,authenticated;
alter default privileges in schema public grant all on tables to service_role;alter default privileges in schema public grant all on functions to service_role;"""
sql('office',hardening)
for f in [O/'db'/foundation,*follows,O/'db/20261107_hardware_orders.sql',O/'db/20261108_hardware_checkout.sql',*sorted((O/'db/phase4c').glob('2026*.sql')),*sorted((O/'db/phase4d').glob('2026*.sql')),*sorted((O/'db/phase4e').glob('2026*.sql'))]:sql('office','begin;'+f.read_text()+'commit;')
for f in ['20261026094951_hardware_payment_attempts.sql','20261026102658_hardware_refund_recovery.sql']:sql('backend','begin;'+(B/'supabase/migrations'/f).read_text()+'commit;')
for db,repo in [('office',O),('backend',B)]:
 if sql(db,(repo/'release/phase4e/security-gate.sql').read_text()).stdout.strip()!='PASS':raise RuntimeError(db+'_security_gate_failed')
print('Both exact Stage4E schema gates PASS',flush=True)
# Synthetic CRM only. No financial transactions or resident records.
sql('office',"insert into crm_contacts(name,email) values('ZZ SYNTHETIC SETUP ONLY','setup@example.invalid');")
for db in ['office','backend']:
 start('hardware-setup-'+db+'-api',['-e','PGRST_DB_URI=postgres://authenticator:'+state['keys'][db+'-pw']+'@hardware-setup-'+db+'-db:5432/postgres','-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=anon','-e','PGRST_JWT_SECRET='+state['keys'][db+'-jwt'],REST])
(RUN/'tls').mkdir(exist_ok=True)
cmd(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(RUN/'tls/key.pem'),'-out',str(RUN/'tls/cert.pem'),'-days','2','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,DNS:office.hardware.test']);os.chmod(RUN/'tls/key.pem',0o600)
start('hardware-setup-gateway',['--network-alias','backend-rest','--network-alias','office-data','--network-alias','office.hardware.test','--cap-drop','ALL','--security-opt','no-new-privileges','-p','127.0.0.1:18443:443','-p','127.0.0.1:18444:4000','-p','127.0.0.1:18445:444','-v',str(BASE/'gateway.cjs')+':/gateway.cjs:ro','-v',str(RUN/'tls')+':/tls:ro',IMAGE,'node','/gateway.cjs'])
common={'NODE_ENV':'test','NEXT_TELEMETRY_DISABLED':'1','NODE_EXTRA_CA_CERTS':'/tls/cert.pem'}
back={**common,'HARDWARE_SETUP_ONLY':'true','HARDWARE_TEST_CALLBACK_ORIGIN':'https://localhost:18443','HARDWARE_PAYSTACK_CALLBACK_URL':'https://localhost:18443/hardware/checkout','HARDWARE_PAYSTACK_SECRET_KEY':'sk_test_SETUP_'+secrets.token_hex(24),'SUPABASE_URL':'http://backend-rest:3000','SUPABASE_SERVICE_ROLE_KEY':jwt('backend'),'HARDWARE_OFFICE_API_KEY':state['keys']['backend']}
for k in ['HARDWARE_PAYMENT_INITIALIZATION_ENABLED','HARDWARE_PAYMENT_PROCESSING_ENABLED','HARDWARE_FINANCIAL_RECOVERY_ENABLED','HARDWARE_REFUNDS_ENABLED']:back[k]='false'
start('hardware-setup-backend',['--cap-drop','ALL','--security-opt','no-new-privileges','--env-file',envfile('backend',back),'-v',str(RUN/'tls/cert.pem')+':/tls/cert.pem:ro',IMAGE,'node','/app/backend/dist/commerce/hardwareSetupServer.js'])
scopes=[{'client':'synthetic-'+k,'key_sha256':hashlib.sha256(state['keys'][k].encode()).hexdigest(),'scopes':[scope]} for k,scope in [('checkout','commerce.checkout.submit'),('confirm','commerce.payment.confirm'),('operations','commerce.payment.operations'),('catalogue','catalogue.public.read')]]
off={**common,'OPENAI_API_KEY':'sk-SETUP-NOT-A-CREDENTIAL','OPENAI_BASE_URL':'http://127.0.0.1:9/v1','ISOLATED_SERVICE':'office','LEAD_AGENTS_HOST':'0.0.0.0','LEAD_AGENTS_PORT':'3000','OFFICE_APP_URL':'https://localhost:18445','LEAD_AGENTS_STORE_DRIVER':'supabase','SUPABASE_URL':'http://office-data:3000','SUPABASE_SERVICE_ROLE_KEY':jwt('office'),'LEAD_AGENTS_AUTH_MODE':'required_api_key','LEAD_AGENTS_API_KEYS':state['keys']['full'],'LEAD_AGENTS_SESSION_SECRET':state['keys']['session'],'LEAD_AGENTS_SCOPED_API_KEYS':json.dumps(scopes,separators=(',',':')),'OFFICE_HARDWARE_ORDERS_ENABLED':'true','OFFICE_HARDWARE_CHECKOUT_ENABLED':'true','OFFICE_HARDWARE_RESERVATIONS_ENABLED':'true','OFFICE_HARDWARE_PAYMENTS_ENABLED':'false','OFFICE_HARDWARE_PAYMENT_PROCESSING_ENABLED':'false','OFFICE_HARDWARE_FINANCIAL_ENABLED':'true'}
start('hardware-setup-office',['--cap-drop','ALL','--security-opt','no-new-privileges','--env-file',envfile('office',off),'-v',str(RUN/'tls/cert.pem')+':/tls/cert.pem:ro','-v',str(BASE/'guard.cjs')+':/guard.cjs:ro','-w','/app/office',IMAGE,'node','--require','/guard.cjs','lead-agents-server.js'])
front={**common,'ISOLATED_SERVICE':'getoyi','NODE_ENV':'production','HARDWARE_CATALOGUE_ENABLED':'false','HARDWARE_CHECKOUT_ENABLED':'false','HARDWARE_PAYMENTS_ENABLED':'false','GETOYI_CHECKOUT_ORIGIN':'https://localhost:18443','HARDWARE_CHECKOUT_SESSION_SECRET':state['keys']['guest'],'OCHIGA_OFFICE_CHECKOUT_URL':'https://office.hardware.test','OCHIGA_OFFICE_CHECKOUT_KEY':state['keys']['checkout']}
start('hardware-setup-getoyi',['--cap-drop','ALL','--security-opt','no-new-privileges','--env-file',envfile('getoyi',front),'-v',str(RUN/'tls/cert.pem')+':/tls/cert.pem:ro','-v',str(BASE/'guard.cjs')+':/guard.cjs:ro','-w','/app/getoyi',IMAGE,'node','--require','/guard.cjs','node_modules/next/dist/bin/next','start','-H','0.0.0.0','-p','3000'])
cmd(['docker','network','create','--opt','com.docker.network.bridge.enable_ip_masquerade=false','hardware-setup-ingress']);cmd(['docker','network','connect','hardware-setup-ingress','hardware-setup-gateway']);state['ingress']='hardware-setup-ingress';save()
print('Setup services launched; transactions OFF',flush=True)
