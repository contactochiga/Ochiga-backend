"""Repeatable local HTTP rehearsal. Never creates an order, run, intent or ticket.
Uses the latest synthetic boundary fixture already in the isolated database.
Refuses before HTTP calls unless both services are disabled and private.
Prints allowlisted status evidence only. No provider URL is contacted.
"""
import hashlib
import json
import pathlib
import sqlite3
import ssl
import subprocess
import urllib.error
import urllib.request

ROOT = pathlib.Path('/Users/ochigaidoko/getoyi-commerce/phase4/stage4e/environment-setup/runtime')

def command(args, stdin=None):
    r = subprocess.run(args, input=stdin, text=True, capture_output=True, timeout=30)
    if r.returncode:
        raise RuntimeError('local_command_failed')
    return r.stdout.strip()

def inspect(name):
    return json.loads(command(['docker', 'inspect', name]))[0]

def env(c):
    return dict(x.split('=', 1) for x in c['Config']['Env'])

def sql(service, statement):
    return command(['docker', 'exec', '-i', f'hardware-setup-{service}-db',
                    'psql', '-X', '-Atq', '-U', 'postgres', '-d', 'postgres',
                    '-v', 'ON_ERROR_STOP=1'], statement)

def require(condition, code):
    if not condition:
        raise RuntimeError(code)

def post(path, key, body):
    ctx = ssl.create_default_context(cafile=str(ROOT / 'tls/cert.pem'))
    request = urllib.request.Request('https://localhost:18445' + path,
        data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'X-API-Key': key})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            raise RuntimeError('unexpected_redirect')
    opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx), NoRedirect)
    try:
        response = opener.open(request, timeout=15)
    except urllib.error.HTTPError as e:
        response = e
    with response:
        data = json.loads(response.read())
        return response.status, data

def snapshot():
    tables = {
        'office': ['hardware_payment_authorizations', 'hardware_payment_confirmations',
                   'hardware_payment_history', 'hardware_financial_observations',
                   'hardware_refund_requests', 'hardware_refund_decisions',
                   'hardware_reservations', 'hardware_reservation_events',
                   'hardware_orders', 'catalogue_variants', 'audit_events'],
        'backend': ['hardware_payment_attempts', 'hardware_payment_events', 'hardware_payment_inbox',
                    'hardware_refunds', 'hardware_refund_events'],
    }
    result = {}
    for service, names in tables.items():
        for name in names:
            result[service + '.' + name] = sql(service,
                f"select count(*)||':'||md5(coalesce(string_agg(row_to_json(t)::text,'|' order by row_to_json(t)::text),'')) from {name} t;")
    return result

def main():
    office, backend = inspect('hardware-setup-office'), inspect('hardware-setup-backend')
    oe, be = env(office), env(backend)
    for c in (office, backend):
        require(c['State']['Running'] and list(c['NetworkSettings']['Networks']) == ['hardware-setup-private'], 'private_runtime_required')
        require(c['HostConfig']['RestartPolicy']['Name'] == 'no', 'restart_policy_mismatch')
    require(json.loads(command(['docker','network','inspect','hardware-setup-private']))[0]['Internal'], 'internal_network_required')
    for key in ['OFFICE_HARDWARE_PAYMENTS_ENABLED', 'OFFICE_HARDWARE_PAYMENT_PROCESSING_ENABLED']:
        require(oe.get(key) == 'false', 'office_execution_not_disabled')
    for key in ['HARDWARE_PAYMENT_INITIALIZATION_ENABLED', 'HARDWARE_PAYMENT_PROCESSING_ENABLED', 'HARDWARE_FINANCIAL_RECOVERY_ENABLED', 'HARDWARE_REFUNDS_ENABLED']:
        require(be.get(key) == 'false', 'backend_execution_not_disabled')
    for e in (oe, be):
        require(not any(e.get(k) for k in ['PAYSTACK_SECRET_KEY','PAYSTACK_SECRECT_KEY','DATABASE_URL','RESEND_API_KEY','SMTP_HOST']), 'forbidden_credential_or_notification_binding')
        require(not any('sk_live_' in v for v in e.values()), 'live_key_present')
    require(oe['SUPABASE_URL']=='http://office-data:3000' and be['SUPABASE_URL']=='http://backend-rest:3000','isolated_db_binding_required')
    require(be.get('HARDWARE_PAYSTACK_SECRET_KEY','').startswith('sk_test_SETUP_'), 'synthetic_payment_factory_required')
    require(oe.get('HARDWARE_PAYMENT_BACKEND_URL')=='https://office.hardware.test/backend', 'office_backend_url_unconfigured')
    require(oe.get('HARDWARE_PAYMENT_BACKEND_KEY')==be.get('HARDWARE_OFFICE_API_KEY') and len(be.get('HARDWARE_OFFICE_API_KEY',''))>=32, 'service_credential_mismatch')
    relay=inspect('hardware-provider-financial-single-init-stopped')
    require(not relay['State']['Running'] and not relay['NetworkSettings']['Networks'] and relay['HostConfig']['RestartPolicy']['Name']=='no','stale_relay_not_quarantined')
    ledger_bytes=(ROOT/'execution/run.sqlite').read_bytes()
    connection=sqlite3.connect('file:'+str(ROOT/'execution/run.sqlite')+'?mode=ro', uri=True)
    with connection:
        enabled, stopped, mode=connection.execute('select enabled,stopped,mode from run').fetchone()
        intents=connection.execute('select count(*) from intents').fetchone()[0]
    connection.close()
    require(enabled==0 and intents==0 and mode is None,'disabled_nonexecutable_ledger_required')
    keys=json.loads((ROOT/'state.json').read_text())['keys']
    scopes=json.loads(oe['LEAD_AGENTS_SCOPED_API_KEYS'])
    for key, scope in [('checkout','commerce.checkout.submit'),('confirm','commerce.payment.confirm'),('operations','commerce.payment.operations')]:
        matching=[x for x in scopes if x['key_sha256']==hashlib.sha256(keys[key].encode()).hexdigest()]
        require(len(matching)==1 and matching[0]['scopes']==[scope], 'service_scope_not_narrow')
    fixture=json.loads(sql('office',"select json_build_object('id',r.order_id,'guest_hash',r.guest_hash) from hardware_checkout_receipts r where client='synthetic-checkout' and idempotency_key like 'boundary-%' order by created_at desc limit 1;"))
    before=snapshot()
    prefix='/api/commerce/checkout/'
    status, quote=post(prefix+'payment-quote', keys['checkout'], fixture)
    require(status==200, 'quote_http_failed')
    p=quote['payment']
    allowed=['eligible','reservation_expired','delivery_unconfirmed','order_cancelled','order_state_invalid','payment_already_started','reservation_missing','reservation_invalid','product_or_variant_unavailable','approved_price_missing_or_changed','catalogue_or_price_ineligible']
    require(p.get('eligibility_code') in allowed,'quote_code_not_allowlisted')
    status2, denial=post(prefix+'payment-start',keys['checkout'],{**fixture,'accepted_total_kobo':10000})
    require(status2==503 and denial.get('error')=='payments_disabled','office_start_not_disabled')
    status3, _=post(prefix+'payment-quote',keys['catalogue'],fixture)
    require(status3==403,'wrong_scope_not_denied')
    status4, _=post(prefix+'payment-quote',keys['checkout'],{**fixture,'guest_hash':'0'*64})
    require(status4==404,'guest_ownership_not_enforced')
    # Actual Office HTTP client to Backend, using the running Office service env.
    js="""const {initializeHardwarePayment}=require('./src/lead-agents/hardware-payments-api');
(async()=>{let upstream;try{await initializeHardwarePayment({});upstream={unexpected:true}}catch(e){upstream={status:e.statusCode,code:e.code}}
const r=await Promise.all(['/initialize','/reconcile','/refund'].map(p=>fetch('http://hardware-setup-backend:3000/hardware-payments'+p,{method:'POST',headers:{'content-type':'application/json','x-office-api-key':process.env.HARDWARE_PAYMENT_BACKEND_KEY},body:'{}',redirect:'error',signal:AbortSignal.timeout(8000)})));
const bad=await fetch('http://hardware-setup-backend:3000/hardware-payments/initialize',{method:'POST',headers:{'content-type':'application/json','x-office-api-key':'synthetic-invalid'},body:'{}'});
console.log(JSON.stringify({upstream,statuses:r.map(x=>x.status),bad_key:bad.status}));})().catch(()=>process.exit(1));"""
    boundary=json.loads(command(['docker','exec','-i','-w','/app/office','hardware-setup-office','node'],js))
    require(boundary=={'upstream':{'status':503,'code':'payments_disabled'},'statuses':[503,503,404],'bad_key':403},'backend_http_boundary_failed')
    require(snapshot()==before,'read_only_financial_or_inventory_snapshot_changed')
    require((ROOT/'execution/run.sqlite').read_bytes()==ledger_bytes,'disabled_ledger_changed')
    result={'office_quote':{'http':status,'eligible':p['eligible'],'code':p['eligibility_code'],'amount_kobo':p['amount_kobo']},
        'office_start':{'http':status2,'code':denial['error']},'wrong_scope':status3,'wrong_guest':status4,
        'backend':boundary,'financial_inventory_audit_snapshots_unchanged':True,'ledger_disabled':True,'new_intents_or_dispatch_tickets':0,
        'relay_networks':[],'provider_requests':0,'executable_run_created':False}
    print(json.dumps(result,indent=2))

if __name__=='__main__':
    try: main()
    except Exception as e:
        # Error text from external tools/payloads is intentionally suppressed.
        print(json.dumps({'result':'FAIL','type':type(e).__name__}))
        raise SystemExit(1)
