from pathlib import Path
import subprocess,secrets,json,os,ssl,urllib.request,urllib.error,http.cookiejar
R=Path(__file__).resolve().parent/'runtime';BASE='https://localhost:18445';P='/api/lead-agents/admin/catalogue'
def sql(q):
 x=subprocess.run(['docker','exec','-i','hardware-setup-office-db','psql','-X','-Atq','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],input=q,text=True,capture_output=True)
 if x.returncode:raise RuntimeError('local_fixture_sql_failed')
 return x.stdout.strip()
assert subprocess.check_output(['docker','inspect','--format','{{index .Config.Labels "getoyi.isolated.setup"}}','hardware-setup-office-db'],text=True).strip()=='true'
roles={'author':['catalogue.read','catalogue.write','inventory.manage','commerce.orders.read','commerce.orders.create','crm.read'],'reviewer':['catalogue.read','catalogue.review'],'price':['catalogue.read','catalogue.price.approve'],'publisher':['catalogue.read','catalogue.publish','catalogue.public.publish','commerce.orders.read','commerce.orders.delivery.confirm']}
cred=R/'fixture-actors.json'
if not cred.exists():
 records={};statements=['begin;']
 for role,scopes in roles.items():
  pw=secrets.token_urlsafe(32);email='setup-'+role+'-commerce@example.invalid';records[role]={'email':email,'password':pw}
  code="let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>process.stdout.write(require('/app/office/src/lead-agents/auth').hashPassword(s)));"
  h=subprocess.run(['docker','exec','-i','hardware-setup-office','node','-e',code],input=pw,text=True,capture_output=True,check=True).stdout
  statements.append("insert into admin_users(email,password_hash,role,status,permission_scopes) values('"+email+"','"+h+"','ochiga_staff','active',array["+','.join("'"+s+"'" for s in scopes)+"]);")
 statements.append('commit;');sql('\n'.join(statements));fd=os.open(cred,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as f:json.dump(records,f)
records=json.loads(cred.read_text());clients={}
for role,c in records.items():
 jar=http.cookiejar.CookieJar();o=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar),urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=str(R/'tls/cert.pem'))))
 with o.open(urllib.request.Request(BASE+'/api/lead-agents/admin/session/login',data=json.dumps(c).encode(),headers={'Content-Type':'application/json','Origin':BASE})) as z:assert z.status==200
 clients[role]=o

def api(role,method,path,body=None,raw=False,expect=None):
 q=urllib.request.Request(BASE+path,method=method,data=body if raw else json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'image/png' if raw else 'application/json','Origin':BASE})
 try:
  with clients[role].open(q,timeout=30) as z:code=z.status;b=json.load(z)
 except urllib.error.HTTPError as z:code=z.code;b=json.load(z)
 if expect is not None:
  assert code==expect,(path,code,b.get('error'));return b
 if code>=400:raise RuntimeError(str((path,code,b.get('error'),b.get('details'))))
 return b
state=R/'commerce-fixture.json'
if not state.exists():
 cats=api('author','GET',P+'/categories')['categories'];cat=cats[0]['id']
 c={'name':'ZZ SYNTHETIC PAYSTACK PREPARATION — NOT FOR SALE','category_id':cat,'brand_id':None,'model':'SETUP-ONLY','summary':'Isolated test fixture only.','description':'Generated test fixture; no commercial product or delivery claim.','specifications':[],'variants':[{'sku':'SETUP-COMMERCE-A','name':'Synthetic A','options':{}},{'sku':'SETUP-COMMERCE-B','name':'Synthetic B','options':{}}]}
 d=api('author','POST',P+'/products',{'slug':'zz-synthetic-commerce-preparation','content':c});state.write_text(json.dumps({'product_id':d['product']['id']}));os.chmod(state,0o600)
s=json.loads(state.read_text());pid=s['product_id'];d=api('author','GET',P+'/products/'+pid)
if not d['content'].get('media'):
 media=[]
 for i in range(5):
  code="require('/app/office/node_modules/sharp')({create:{width:800,height:800,channels:3,background:{r:"+str(40+i*30)+",g:50,b:100}}}).png().toBuffer().then(b=>process.stdout.write(b))"
  img=subprocess.check_output(['docker','exec','hardware-setup-office','node','-e',code])
  m=api('author','POST',P+'/products/'+pid+'/media?name=synthetic-'+str(i)+'.png',img,True)
  media.append({'media_id':m['media']['id'],'cover':i==0,'alt':'Synthetic test colour panel '+str(i+1),'caption':'TEST DATA','variant_skus':[]})
 d=api('author','PATCH',P+'/products/'+pid,{'expected_row_version':d['product']['row_version'],'content':{**d['content'],'media':media}})
if d['product']['workflow_status']=='draft':d=api('author','POST',P+'/products/'+pid+'/submit',{'expected_row_version':d['product']['row_version']})
if d['product']['workflow_status']=='in_review':
 api('author','POST',P+'/products/'+pid+'/approve',{'expected_row_version':d['product']['row_version']},expect=403)
 d=api('reviewer','POST',P+'/products/'+pid+'/approve',{'expected_row_version':d['product']['row_version']})
if d['product']['publication_status']!='published':d=api('publisher','POST',P+'/products/'+pid+'/publish',{'expected_row_version':d['product']['row_version']})
for v in d['variants']:
 if v.get('price_ngn_kobo')!=10000:
  change=api('author','POST',P+'/variants/'+v['id']+'/price-changes',{'price_ngn_kobo':10000,'vat_treatment':'standard','vat_rate_bp':750,'note':'SYNTHETIC NGN100 VAT-inclusive test fixture'})['price_change']
  api('price','POST',P+'/price-changes/'+change['id']+'/approve',{'note':'Independent synthetic price approval'})
  api('publisher','POST',P+'/price-changes/'+change['id']+'/publish',{})
 d=api('author','GET',P+'/products/'+pid);v=next(x for x in d['variants'] if x['id']==v['id'])
 if v.get('stock_on_hand')!=24:api('author','PATCH',P+'/variants/'+v['id']+'/inventory',{'expected_row_version':v['row_version'],'stock_on_hand':24,'sourcing':'in_stock','reason':'Synthetic stock in disposable database only'})
d=api('author','GET',P+'/products/'+pid)
if sql("select count(*) from catalogue_public_listings where product_id='"+pid+"' and status='public'")=='0':api('publisher','POST',P+'/products/'+pid+'/public/release',{'expected_row_version':d['product']['row_version'],'expected_listing_row_version':0})
s['variants']=[x['id'] for x in d['variants']];state.write_text(json.dumps(s));print('Synthetic product, five generated panels, independent approvals, two NGN100 variants and local-only listing ready')
# Existing scoped checkout and reservation workflows, with synthetic customers only.
import hashlib
config=json.loads((R/'state.json').read_text());ledger=R/'scenario-orders.json';orders=json.loads(ledger.read_text()) if ledger.exists() else {}
scenarios=['success','declined','delayed_success','duplicate_webhook','redirect_only','amount_mismatch','reference_mismatch','expired_reservation','office_outage','refund_processed','refund_failed','refund_attention']
def checkout(action,body):
 q=urllib.request.Request(BASE+'/api/commerce/checkout/'+action,data=json.dumps(body).encode(),headers={'Content-Type':'application/json','x-api-key':config['keys']['checkout']})
 try:
  with urllib.request.urlopen(q,context=ssl.create_default_context(cafile=str(R/'tls/cert.pem')),timeout=20) as z:return json.load(z)
 except urllib.error.HTTPError as z:raise RuntimeError('checkout_'+str(z.code)+'_'+json.load(z).get('error','unknown'))
for i,scenario in enumerate(scenarios):
 if scenario in orders:continue
 guest=hashlib.sha256(('isolated-preparation-'+scenario).encode()).hexdigest()
 lines=[{'product':'zz-synthetic-commerce-preparation','sku':'SETUP-COMMERCE-'+('A' if i%2==0 else 'B'),'quantity':1}]
 quote=checkout('quote',{'lines':lines})['quote']
 result=checkout('submit',{'guest_hash':guest,'idempotency_key':'setup-execution-'+scenario.replace('_','-'),'quote_hash':quote['quote_hash'],'order':{'lines':lines,'customer':{'name':'ZZ SYNTHETIC '+scenario,'email':'setup-'+scenario.replace('_','-')+'@example.invalid','phone':'+2348000000000'},'delivery':{'country':'NG','state':'Plateau','city':'Jos','address':'SYNTHETIC DISPOSABLE TEST ADDRESS'},'installation_requested':False}})
 order=result['order'];oid=order['id']
 # Existing audited DB workflow enforces actor permission; no direct financial column updates.
 sql("select hardware_payment_confirm_delivery('setup-publisher-commerce@example.invalid','"+oid+"',0,0,'SYNTHETIC LOCAL TEST ONLY: zero delivery charge; no real serviceability claim')")
 orders[scenario]={'order_id':oid,'guest_hash':guest,'amount_kobo':10000,'quantity':1,'evidence':'synthetic-fixture'}
 ledger.write_text(json.dumps(orders,indent=2));os.chmod(ledger,0o600)
print(str(len(orders))+' synthetic scenario orders prepared through scoped checkout; no provider authorization or payment requested')
