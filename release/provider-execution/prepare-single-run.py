"""Prepare exactly one isolated NGN100 order and a disabled single-use ledger.

Profiles: single-initialization-only (default) or, with --profile single-payment, single-payment-acceptance
(one initialization, at most three verification reads of the same reference, webhook ingestion, no refunds).

This script uses the existing isolated Office checkout endpoint. It cannot
enable the executor or call Paystack. Only --prepare is accepted.
"""
import hashlib, json, os, re, secrets, ssl, subprocess, sys, urllib.error, urllib.request
from pathlib import Path
from executor import Executor
from bridge import main as bridge_main

BASE=Path('/Users/ochigaidoko/getoyi-commerce/phase4/stage4e/environment-setup')
R=BASE/'runtime'
PROFILES={
 'single-init':{'manifest':'single-init-manifest.json','profile':'single-initialization-only','scenario':'single_initialization','budget':{'initialize':1,'read':0,'refund':0},'state':'single_init_runs'},
 'single-payment':{'manifest':'single-payment-manifest.json','profile':'single-payment-acceptance','scenario':'single_payment','budget':{'initialize':1,'read':3,'refund':0},'state':'single_payment_runs'},
}
P=PROFILES['single-init']
IMAGE=os.environ.get('HARDWARE_EXECUTOR_IMAGE','')
API='https://localhost:18445/api/commerce/checkout/'

def mask(v):
 # Evidence shows only the first character and the domain of the approved inbox.
 return None if not v else v[0]+'***@'+v.split('@',1)[1]

def sql(query):
 r=subprocess.run(['docker','exec','-i','hardware-setup-office-db','psql','-X','-Atq','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],input=query,text=True,capture_output=True)
 if r.returncode: raise RuntimeError('isolated_office_fixture_check_failed')
 return r.stdout.strip()

def post(action,payload,key,ctx):
 req=urllib.request.Request(API+action,data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','x-api-key':key})
 try:
  with urllib.request.urlopen(req,context=ctx,timeout=20) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:
  try:body=json.load(e)
  except Exception:body={}
  raise RuntimeError('isolated_checkout_'+str(e.code)+'_'+str(body.get('error','rejected')))

def seal_counter(runroot, run_id, plan_hash, manifest, image, state):
 # A fresh durable provider-request counter for this run only (the profile's exact budget). Never reused.
 counter=runroot/'provider-counter'
 r=subprocess.run(['node',str(Path(__file__).with_name('provider-counter.cjs')),'--prepare',str(counter),plan_hash],input=json.dumps(manifest),text=True,capture_output=True)
 if r.returncode or json.loads(r.stdout).get('budget')!=P['budget']: raise RuntimeError('provider_counter_preparation_failed')
 volume='hardware-provider-counter-single-'+run_id
 subprocess.run(['docker','volume','create','--label','getoyi.isolated.execution=true','--label','getoyi.provider.counter=true',volume],check=True,stdout=subprocess.DEVNULL)
 copy="import shutil,os;shutil.copytree('/seed','/run/provider-counter',dirs_exist_ok=True);[(os.chown(p,1000,1000),os.chmod(p,0o700 if os.path.isdir(p) else 0o600)) for p in ['/run/provider-counter']+[os.path.join(d,n) for d,ds,fs in os.walk('/run/provider-counter') for n in ds+fs]]"
 subprocess.run(['docker','run','--rm','--network','none','-v',str(counter)+':/seed:ro','-v',volume+':/run/provider-counter',image,'python3','-c',copy],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 state.setdefault('provider_counter_volumes',[]).append(volume)
 return volume

def seal_current(manifest, state, ctx, checkout_key, image):
 # Seal the one already-created eligible synthetic checkout. This path is
 # read-only against Office/Backend except for creating a new disabled runner
 # ledger/volume; it never submits another order or contacts Paystack.
 rows=sql("""select o.id::text||'|'||r.guest_hash||'|'||r.idempotency_key||'|'||o.goods_total_kobo::text||'|'||o.payable_total_kobo::text||'|'||o.payment_state||'|'||o.order_state||'|'||v.state||'|'||(v.expires_at>clock_timestamp())::text||'|'||(select count(*) from hardware_order_lines l where l.order_id=o.id)::text||'|'||(select string_agg(l.sku||':'||l.quantity::text,',') from hardware_order_lines l where l.order_id=o.id) from hardware_orders o join hardware_checkout_receipts r on r.order_id=o.id and r.client='synthetic-checkout' join hardware_order_private p on p.order_id=o.id join hardware_reservations v on v.order_id=o.id where p.customer->>'email' like 'setup-single-%@example.invalid' and v.state='held' and v.expires_at>clock_timestamp() order by o.created_at desc limit 2""").splitlines()
 if len(rows)!=1: raise RuntimeError('exactly_one_fresh_held_synthetic_order_required')
 parts=rows[0].split('|')
 if len(parts)!=11: raise RuntimeError('synthetic_order_shape_invalid')
 order_id,guest,key,goods,payable,payment_state,order_state,res_state,res_valid,line_count,sku_qty=parts
 if (goods,payable,payment_state,order_state,res_state,res_valid,line_count,sku_qty)!=('10000','10000','not_started','awaiting_confirmation','held','true','1','SETUP-COMMERCE-A:1'):
  raise RuntimeError('fresh_synthetic_order_ineligible')
 code,payment=post('payment-quote',{'id':order_id,'guest_hash':guest},checkout_key,ctx);p=payment.get('payment',{})
 if code!=200 or p.get('eligible') is not True or p.get('payment_state')!='not_started' or p.get('amount_kobo')!=10000 or p.get('currency') not in (None,'NGN'):
  raise RuntimeError('fresh_order_payment_quote_ineligible')
 old=subprocess.check_output(['docker','exec','hardware-setup-backend-db','psql','-X','-Atq','-U','postgres','-d','postgres','-c',"select reference||'|'||order_id::text||'|'||reservation_id::text||'|'||state from hardware_payment_attempts where state='uncertain' order by created_at desc limit 2"],text=True).strip().splitlines()
 if len(old)!=1 or old[0].count('|')!=3: raise RuntimeError('original_uncertain_attempt_missing_or_ambiguous')
 old_ref,old_order,old_reservation,old_state=old[0].split('|')
 if not re.fullmatch(r'hwo_[0-9a-f]{32}',old_ref) or old_state!='uncertain': raise RuntimeError('original_reference_guard_failed')
 old_office=sql("select o.payment_state||'|'||v.state||'|'||count(c.order_id)::text from hardware_orders o join hardware_reservations v on v.order_id=o.id left join hardware_payment_confirmations c on c.order_id=o.id where o.id='"+old_order+"'::uuid group by o.payment_state,v.state")
 if old_office!='not_started|expired|0': raise RuntimeError('original_uncertain_order_history_changed')
 if subprocess.check_output(['docker','exec','hardware-setup-backend-db','psql','-X','-Atq','-U','postgres','-d','postgres','-c',"select count(*) from hardware_payment_attempts where order_id='"+order_id+"'::uuid"],text=True).strip()!='0': raise RuntimeError('fresh_order_has_existing_payment_attempt')
 run_id=secrets.token_hex(6);runroot=R/'execution'/'runs'/run_id;runroot.mkdir(parents=True,mode=0o700)
 fixture={'order_id':order_id,'guest_hash':guest,'idempotency_key':key,'amount_kobo':10000,'quantity':1,'evidence':'synthetic-single-init'}
 (runroot/'scenario-orders.json').write_text(json.dumps({P['scenario']:fixture},indent=2));os.chmod(runroot/'scenario-orders.json',0o600)
 ledger=runroot/'run.sqlite';e=Executor(str(ledger),manifest);digest=e.digest;e.close()
 plan=[{'reference':'hwo_'+order_id.replace('-',''),'scenario':P['scenario'],'amount':10000}]
 plan_hash=bridge_main({'database':str(ledger),'manifest':manifest,'mode':'real-provider','action':'prepare','plan':plan})['plan_sha256']
 config={'database':'/run/execution/run.sqlite','manifest':manifest,'mode':'real-provider','planSha256':plan_hash,'python':'python3'}
 (runroot/'config.json').write_text(json.dumps(config,indent=2));os.chmod(runroot/'config.json',0o600)
 auth={'manifest_sha256':digest,'plan_sha256':plan_hash,'authorized':False,'environment':'test','evidence':'real-provider'}
 (runroot/'authorization-required.json').write_text(json.dumps(auth,indent=2));os.chmod(runroot/'authorization-required.json',0o600)
 volume='hardware-execution-ledger-single-'+run_id
 subprocess.run(['docker','volume','create','--label','getoyi.isolated.execution=true',volume],check=True,stdout=subprocess.DEVNULL)
 copy="import shutil,os;shutil.copytree('/seed','/run/execution',dirs_exist_ok=True);[(os.chown(p,1000,1000),os.chmod(p,0o700 if os.path.isdir(p) else 0o600)) for p in ['/run/execution']+[os.path.join(d,n) for d,ds,fs in os.walk('/run/execution') for n in ds+fs]]"
 subprocess.run(['docker','run','--rm','--network','none','-v',str(runroot)+':/seed:ro','-v',volume+':/run/execution',image,'python3','-c',copy],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 counter_volume=seal_counter(runroot,run_id,plan_hash,manifest,IMAGE,state)
 state.setdefault('execution_volumes',[]).append(volume);state.setdefault(P['state'],[]).append({'run_id':run_id,'ledger_volume':volume,'provider_counter_volume':counter_volume,'authorization_required':True,'provider_calls':0})
 (R/'state.json').write_text(json.dumps(state,indent=2));os.chmod(R/'state.json',0o600)
 print(json.dumps({'run_id':run_id,'ledger_volume':volume,'provider_counter_volume':counter_volume,'profile':P['profile'],'customer_inbox':mask(manifest.get('customer_email')),'provider_request_budget':P['budget'],'plan_items':1,'amount_kobo':10000,'refund_budget':0,'provider_reads':P['budget']['read'],'webhook_replays':0,'authorized':False,'provider_calls':0,'fresh_order_eligible':True,'fresh_reservation_valid':True,'original_payment_preserved':True,'original_reservation_expired_by_normal_checkout_flow':True}))

def main():
 global P
 args=sys.argv[1:];inbox=None
 if '--customer-email' in args:
  i=args.index('--customer-email');inbox=args[i+1] if i+1<len(args) else None;args=args[:i]+args[i+2:]
 if len(args)==3 and args[1]=='--profile' and args[2] in PROFILES: P=PROFILES[args[2]];args=args[:1]
 # Single payment: the owner-approved test inbox is bound into this run's manifest (and authorization hash).
 if P['profile']=='single-payment-acceptance':
  from executor import approved_test_inbox
  if args!=['--prepare'] or not approved_test_inbox(inbox): raise RuntimeError('approved_test_inbox_required')
 elif inbox is not None: raise RuntimeError('customer_email_only_for_single_payment')
 if args not in (['--prepare'],['--seal-current']): raise SystemExit('Only local preparation modes are supported; this script cannot execute or authorize payments.')
 if not IMAGE or not re.fullmatch(r'getoyi-bounded-execution:[a-f0-9]{7,40}-single-(init|payment)',IMAGE): raise RuntimeError('reviewed_executor_image_required')
 for name in ['hardware-setup-office-db','hardware-setup-backend-db']:
  if subprocess.check_output(['docker','inspect','--format','{{index .Config.Labels "getoyi.isolated.setup"}}',name],text=True).strip()!='true': raise RuntimeError('labelled_disposable_databases_required')
 manifest=json.loads(Path(__file__).with_name(P['manifest']).read_text())
 if inbox is not None: manifest={**manifest,'customer_email':inbox}
 if manifest.get('execution_profile')!=P['profile'] or manifest.get('max_payment_initializations')!=1 or manifest.get('max_total_payment_kobo')!=10000 or manifest.get('max_refund_initializations')!=0 or manifest.get('max_provider_reads')!=P['budget']['read'] or manifest.get('max_webhook_replays')!=0: raise RuntimeError('single_use_manifest_invalid')
 state=json.loads((R/'state.json').read_text());checkout_key=state['keys']['checkout']
 ctx=ssl.create_default_context(cafile=str(R/'tls/cert.pem'))
 if args==['--seal-current']:
  seal_current(manifest,state,ctx,checkout_key,IMAGE);return
 old=subprocess.check_output(['docker','exec','hardware-setup-backend-db','psql','-X','-Atq','-U','postgres','-d','postgres','-c',"select reference||'|'||order_id::text||'|'||reservation_id::text||'|'||state from hardware_payment_attempts where state='uncertain' order by created_at desc limit 2"],text=True).strip().splitlines()
 if len(old)!=1 or old[0].count('|')!=3: raise RuntimeError('original_uncertain_attempt_missing_or_ambiguous')
 old_ref,old_order,old_reservation,old_attempt_state=old[0].split('|')
 if not re.fullmatch(r'hwo_[0-9a-f]{32}',old_ref) or old_attempt_state!='uncertain': raise RuntimeError('original_reference_guard_failed')
 run_id=secrets.token_hex(6);guest=hashlib.sha256(('single-init-'+run_id+'-'+secrets.token_hex(24)).encode()).hexdigest();key='single-init-'+run_id+'-'+secrets.token_hex(12)
 client='synthetic-single-init-'+run_id
 lines=[{'product':'zz-synthetic-commerce-preparation','sku':'SETUP-COMMERCE-A','quantity':1}]
 code,quoted=post('quote',{'lines':lines},checkout_key,ctx)
 q=quoted.get('quote',{})
 if code!=200 or q.get('goods_total_kobo')!=10000 or len(q.get('lines',[]))!=1 or q['lines'][0].get('quantity')!=1: raise RuntimeError('fresh_order_quote_not_exactly_ngn100')
 request={'lines':lines,'customer':{'name':'ZZ SINGLE INIT SYNTHETIC','email':manifest.get('customer_email') or 'setup-'+P['scenario'].replace('_','-')+'-'+run_id+'@example.invalid','phone':'+2348000000000'},'delivery':{'country':'NG','state':'Plateau','city':'Jos','address':'SYNTHETIC DISPOSABLE TEST ADDRESS'},'installation_requested':False}
 code,submitted=post('submit',{'guest_hash':guest,'idempotency_key':key,'quote_hash':q['quote_hash'],'order':request},checkout_key,ctx)
 order=submitted.get('order') or {};order_id=order.get('id')
 if code not in (200,201) or not isinstance(order_id,str) or not re.fullmatch(r'[0-9a-f-]{36}',order_id): raise RuntimeError('fresh_synthetic_checkout_not_created')
 # The established fixture-only delivery confirmation records an audit event.
 sql("select hardware_payment_confirm_delivery('setup-publisher-commerce@example.invalid','"+order_id+"',0,0,'SYNTHETIC LOCAL ONLY: zero delivery charge; no real delivery claim')")
 code,payment=post('payment-quote',{'id':order_id,'guest_hash':guest},checkout_key,ctx);p=payment.get('payment',{})
 if code!=200 or p.get('eligible') is not True or p.get('payment_state')!='not_started' or p.get('amount_kobo')!=10000: raise RuntimeError('fresh_order_payment_quote_ineligible')
 fresh=sql("select r.state||'|'||(r.expires_at>clock_timestamp())::text||'|'||o.payment_state||'|'||o.order_state from hardware_reservations r join hardware_orders o on o.id=r.order_id where o.id='"+order_id+"'::uuid")
 if fresh!='held|true|not_started|awaiting_confirmation': raise RuntimeError('fresh_reservation_not_held_and_valid')
 # Expiry ran inside the existing checkout-reservation transaction. It may
 # release only expired local fixture holds; payment history must remain unchanged.
 old_state=sql("select o.payment_state||'|'||r.state||'|'||count(c.order_id)::text from hardware_orders o join hardware_reservations r on r.order_id=o.id left join hardware_payment_confirmations c on c.order_id=o.id where o.id='"+old_order+"'::uuid group by o.payment_state,r.state")
 if old_state!='not_started|expired|0': raise RuntimeError('original_uncertain_order_history_changed_or_expiry_not_applied')
 # No provider operation is made here. Build an immutable, one-reference plan.
 runroot=R/'execution'/'runs'/run_id;runroot.mkdir(parents=True,mode=0o700)
 fixture={'order_id':order_id,'guest_hash':guest,'idempotency_key':key,'amount_kobo':10000,'quantity':1,'evidence':'synthetic-single-init'}
 (runroot/'scenario-orders.json').write_text(json.dumps({P['scenario']:fixture},indent=2));os.chmod(runroot/'scenario-orders.json',0o600)
 ledger=runroot/'run.sqlite';e=Executor(str(ledger),manifest);digest=e.digest;e.close()
 plan=[{'reference':'hwo_'+order_id.replace('-',''),'scenario':P['scenario'],'amount':10000}]
 qbridge={'database':str(ledger),'manifest':manifest,'mode':'real-provider','action':'prepare','plan':plan}
 plan_hash=bridge_main(qbridge)['plan_sha256']
 config={'database':'/run/execution/run.sqlite','manifest':manifest,'mode':'real-provider','planSha256':plan_hash,'python':'python3'}
 (runroot/'config.json').write_text(json.dumps(config,indent=2));os.chmod(runroot/'config.json',0o600)
 auth={'manifest_sha256':digest,'plan_sha256':plan_hash,'authorized':False,'environment':'test','evidence':'real-provider'}
 (runroot/'authorization-required.json').write_text(json.dumps(auth,indent=2));os.chmod(runroot/'authorization-required.json',0o600)
 volume='hardware-execution-ledger-single-'+run_id
 subprocess.run(['docker','volume','create','--label','getoyi.isolated.execution=true',volume],check=True,stdout=subprocess.DEVNULL)
 copy="import shutil,os;shutil.copytree('/seed','/run/execution',dirs_exist_ok=True);[(os.chown(p,1000,1000),os.chmod(p,0o700 if os.path.isdir(p) else 0o600)) for p in ['/run/execution']+[os.path.join(d,n) for d,ds,fs in os.walk('/run/execution') for n in ds+fs]]"
 subprocess.run(['docker','run','--rm','--network','none','-v',str(runroot)+':/seed:ro','-v',volume+':/run/execution',IMAGE,'python3','-c',copy],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 counter_volume=seal_counter(runroot,run_id,plan_hash,manifest,IMAGE,state)
 state.setdefault('execution_volumes',[]).append(volume);state.setdefault(P['state'],[]).append({'run_id':run_id,'ledger_volume':volume,'provider_counter_volume':counter_volume,'authorization_required':True,'provider_calls':0})
 (R/'state.json').write_text(json.dumps(state,indent=2));os.chmod(R/'state.json',0o600)
 print(json.dumps({'run_id':run_id,'ledger_volume':volume,'provider_counter_volume':counter_volume,'profile':P['profile'],'customer_inbox':mask(manifest.get('customer_email')),'provider_request_budget':P['budget'],'plan_items':1,'amount_kobo':10000,'refund_budget':0,'provider_reads':P['budget']['read'],'webhook_replays':0,'authorized':False,'provider_calls':0,'fresh_order_eligible':True,'fresh_reservation_valid':True,'original_payment_preserved':True,'original_reservation_expired_by_normal_checkout_flow':True}))

if __name__=='__main__':
 try:main()
 except Exception:
  print('single_init_preparation_failed; no provider calls; preserve isolated evidence',file=sys.stderr);sys.exit(1)
