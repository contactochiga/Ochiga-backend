"""single-payment-acceptance profile: ledger and bridge budget rules. Disposable temp ledgers, no network."""
import unittest,tempfile,pathlib,json,sys,copy,concurrent.futures,sqlite3
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from executor import Executor,Denied
from bridge import main as bridge
TEMPLATE=json.loads((pathlib.Path(__file__).parent/'single-payment-manifest.json').read_text())
# Preparation binds the owner-approved inbox into each run's manifest; tests use a synthetic deliverable-form address.
P={**TEMPLATE,'customer_email':'acceptance-inbox@payments-test.getoyi.com'}
REF='hwo_'+'a'*32
def rid(n):return 'hwo_'+format(n,'032x')
class Tests(unittest.TestCase):
 def setUp(self):
  self.d=tempfile.TemporaryDirectory();self.p=str(pathlib.Path(self.d.name)/'run.sqlite')
  e=Executor(self.p,P);self.digest=e.digest;e.close()
  self.q=dict(database=self.p,manifest=P,mode='mock')
  self.q['plan_sha256']=bridge({**self.q,'action':'prepare','plan':[{'reference':REF,'scenario':'single_payment','amount':10000}]})['plan_sha256']
 def tearDown(self):self.d.cleanup()
 def b(self,action,**k):return bridge({**self.q,'action':action,**k})
 def arm(self):self.b('arm',approval={'manifest_sha256':self.digest,'plan_sha256':self.q['plan_sha256'],'authorized':True,'environment':'test','evidence':'mock'})
 def stopped(self):
  db=sqlite3.connect(self.p);r=db.execute('select stopped from run').fetchone()[0];db.close();return bool(r)
 def claim_payment(self,amount=10000):return self.b('claim',reference=REF,id=REF,kind='payment',amount=amount,request_hash='0'*64)
 def claim_read(self,n):return self.b('claim',reference=REF,id=rid(n),kind='read',amount=0,request_hash='1'*64)

 def test_manifest_is_exact(self):
  for k,v in [('max_payment_initializations',2),('max_total_payment_kobo',20000),('max_refund_initializations',1),('max_refund_kobo',1),('max_webhook_replays',1),('max_provider_reads',4),('max_provider_reads',0),('max_duration_minutes',31),('max_payment_kobo',10001)]:
   m=copy.deepcopy(P);m[k]=v
   with self.assertRaises(Denied,msg=k):Executor(str(pathlib.Path(self.d.name)/('x'+k+str(v))),m)
  m=copy.deepcopy(P);m['scenarios'][0]['id']='success'
  with self.assertRaises(Denied):Executor(str(pathlib.Path(self.d.name)/'scen'),m)
 def test_approved_inbox_required(self):
  for v in (None,'setup-single-payment-abc@example.invalid','a@example.com','a@foo.test','A@getoyi.com','a@localhost','not-an-email',''):
   m=copy.deepcopy(TEMPLATE)
   if v is not None:m['customer_email']=v
   with self.assertRaises(Denied,msg=repr(v)):Executor(str(pathlib.Path(self.d.name)/('inbox'+str(abs(hash(v))))),m)
  self.assertNotIn('customer_email',TEMPLATE,'the committed template carries no inbox')
 def test_plan_is_one_ngn100_item(self):
  p=str(pathlib.Path(self.d.name)/'p2.sqlite');Executor(p,P).close()
  for plan in ([{'reference':REF,'scenario':'single_payment','amount':9999}],[{'reference':REF,'scenario':'single_initialization','amount':10000}],[{'reference':REF,'scenario':'single_payment','amount':10000},{'reference':rid(9),'scenario':'single_payment','amount':10000}]):
   with self.assertRaises(Denied):bridge(dict(database=p,manifest=P,mode='mock',action='prepare',plan=plan))
 def test_disabled_by_default(self):
  with self.assertRaises(Denied):self.claim_payment()
 def test_read_requires_initialization(self):
  self.arm()
  with self.assertRaises(Denied):self.claim_read(1)
  self.assertTrue(self.stopped())
 def test_one_initialization_three_reads(self):
  self.arm();self.assertIn('ticket',self.claim_payment());self.b('record',reference=REF,id=REF,state='returned')
  for n in (1,2,3):self.assertIn('ticket',self.claim_read(n));self.b('record',reference=REF,id=rid(n),state='returned')
  with self.assertRaises(Denied):self.claim_read(4)
  self.assertTrue(self.stopped())
 def test_second_initialization_stops(self):
  self.arm();self.claim_payment();self.b('record',reference=REF,id=REF,state='returned')
  with self.assertRaises(Denied):self.claim_payment()
  self.assertTrue(self.stopped())
 def test_uncertain_initialization_allows_verification_not_retry(self):
  self.arm();self.claim_payment();self.b('record',reference=REF,id=REF,state='uncertain')
  self.assertFalse(self.stopped())  # unlike single-init: verification reads resolve the original reference
  self.assertIn('ticket',self.claim_read(1))
  with self.assertRaises(Denied):self.claim_payment()
  self.assertTrue(self.stopped())
 def test_refund_replay_and_amount_denied(self):
  for kind,amount,parent in (('refund',10000,REF),('replay',0,None)):
   self.setUp();self.arm()
   with self.assertRaises(Denied):self.b('claim',reference=REF,id=rid(7),kind=kind,amount=amount,parent=parent)
   self.assertTrue(self.stopped())
  self.setUp();self.arm()
  with self.assertRaises(Denied):self.claim_payment(9999)
  self.assertTrue(self.stopped())
 def test_ticket_single_use(self):
  self.arm();t=self.claim_payment()['ticket']
  self.assertEqual(self.b('consume',reference=REF,ticket=t,request_hash='0'*64),{'dispatch':True})
  with self.assertRaises(Denied):self.b('consume',reference=REF,ticket=t,request_hash='0'*64)
 def test_notes_do_not_stop_or_spend(self):
  self.arm()
  for _ in range(5):self.assertEqual(self.b('note',event='webhook_signature_rejected'),{'noted':True})
  self.b('note',event='webhook_rate_limited')
  with self.assertRaises(Denied):self.b('note',event='arbitrary')
  self.assertFalse(self.stopped());self.assertIn('ticket',self.claim_payment())
 def test_restart_keeps_budget(self):
  self.arm();self.claim_payment();self.b('record',reference=REF,id=REF,state='returned');self.claim_read(1);self.b('record',reference=REF,id=rid(1),state='returned')
  e=Executor(self.p,P);e.close()  # a fresh process reopens the same ledger
  s=self.b('status');self.assertEqual(s['intent_count'],2);self.assertTrue(s['run_enabled'])
  self.claim_read(2);self.claim_read(3)
  with self.assertRaises(Denied):self.claim_read(4)
 def test_concurrent_initialization_claims_once(self):
  self.arm()
  def go(_):
   try:return 'ticket' in self.claim_payment()
   except Denied:return False
  with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:self.assertEqual(sum(pool.map(go,range(12))),1)
  self.assertEqual(self.b('status')['dispatch_ticket_count'] if not self.stopped() else 1,1)
 def test_other_profiles_reject_note(self):
  S=json.loads((pathlib.Path(__file__).parent/'single-init-manifest.json').read_text())
  p=str(pathlib.Path(self.d.name)/'s.sqlite');e=Executor(p,S);dg=e.digest;e.close()
  q=dict(database=p,manifest=S,mode='mock');q['plan_sha256']=bridge({**q,'action':'prepare','plan':[{'reference':REF,'scenario':'single_initialization','amount':10000}]})['plan_sha256']
  bridge({**q,'action':'arm','approval':{'manifest_sha256':dg,'plan_sha256':q['plan_sha256'],'authorized':True,'environment':'test','evidence':'mock'}})
  with self.assertRaises(Denied):bridge({**q,'action':'note','event':'webhook_signature_rejected'})
if __name__=='__main__':unittest.main()
