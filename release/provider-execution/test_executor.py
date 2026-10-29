import unittest,tempfile,pathlib,json,sys,concurrent.futures
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from executor import Executor,Denied
M=json.loads((pathlib.Path(__file__).parent.parent/'provider-preparation/run-manifest.json').read_text())
S=json.loads((pathlib.Path(__file__).parent/'single-init-manifest.json').read_text())
def uid(n):return 'hwo_'+format(n,'032x')
class Tests(unittest.TestCase):
 def setUp(self):
  self.d=tempfile.TemporaryDirectory();self.p=str(pathlib.Path(self.d.name)/'run.sqlite');self.e=Executor(self.p,M)
 def tearDown(self):self.e.close();self.d.cleanup()
 def enable(self):self.e.enable({'manifest_sha256':self.e.digest,'authorized':True,'environment':'test','evidence':'mock'},mock=True)
 def test_default_disabled(self):
  with self.assertRaises(Denied):self.e.reserve(uid(1),'success','payment',10000)
  self.assertTrue(self.e.disposable())
 def test_resume(self):
  self.enable();self.assertTrue(self.e.reserve(uid(1),'success','payment',10000));self.e.close();self.e=Executor(self.p,M)
  self.assertFalse(self.e.reserve(uid(1),'success','payment',10000))
 def test_concurrency(self):
  self.enable()
  def go(_):
   e=Executor(self.p,M)
   try:return e.reserve(uid(1),'success','payment',10000)
   finally:e.close()
  with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:self.assertEqual(sum(pool.map(go,range(20))),1)
 def test_full_refund(self):
  self.enable();self.e.reserve(uid(1),'success','payment',10000)
  self.e.outcome(uid(1),dict(domain='test',reference=uid(1),currency='NGN',amount=10000,evidence='mock',status='success'))
  with self.assertRaises(Denied):self.e.reserve(uid(2),'refund_processed','refund',9999,uid(1))
 def test_wrong_domain_stops(self):
  self.enable();self.e.reserve(uid(1),'success','payment',10000)
  self.assertEqual(self.e.outcome(uid(1),dict(domain='live',reference=uid(1),currency='NGN',amount=10000,evidence='mock',status='success')),'uncertain')
  with self.assertRaises(Denied):self.e.reserve(uid(2),'declined','payment',10000)
 def test_key_conflict_stops(self):
  self.enable();self.e.reserve(uid(1),'success','payment',10000)
  with self.assertRaises(Denied):self.e.reserve(uid(1),'success','payment',1)
 def test_amount_cap(self):
  self.enable()
  with self.assertRaises(Denied):self.e.reserve(uid(1),'success','payment',10001)
 def test_mock_cannot_provider(self):
  self.enable()
  with self.assertRaises(Denied):self.e.reserve(uid(1),'success','payment',10000,evidence='real-provider')
 def test_manifest_tamper(self):
  with self.assertRaises(Denied):Executor(self.p,{**M,'max_payment_kobo':9999})
 def test_history_immutable(self):
  self.enable()
  with self.assertRaises(Exception):self.e.db.execute('DELETE FROM events')
 def test_scenario_budget(self):
  self.enable();self.e.reserve(uid(1),'success','payment',10000)
  with self.assertRaises(Denied):self.e.reserve(uid(2),'success','payment',10000)
 def test_deadline(self):
  self.enable();self.e.db.execute('UPDATE run SET started=0')
  with self.assertRaises(Denied):self.e.reserve(uid(1),'success','payment',10000)
 def test_refund_cap(self):
  self.enable()
  for i,s in enumerate(['success','declined','delayed_success','duplicate_webhook'],1):
   self.e.reserve(uid(i),s,'payment',10000);self.e.outcome(uid(i),dict(domain='test',reference=uid(i),currency='NGN',amount=10000,evidence='mock',status='success'))
  for i,s in enumerate(['refund_processed','refund_failed','refund_attention'],1):self.e.reserve(uid(10+i),s,'refund',10000,uid(i))
  with self.assertRaises(Denied):self.e.reserve(uid(14),'success','refund',10000,uid(4))
 def test_twelve_payment_limit(self):
  self.enable()
  for i,s in enumerate(M['scenarios']):self.e.reserve(uid(i+1),s['id'],'payment',10000)
  with self.assertRaises(Denied):self.e.reserve(uid(99),'success','payment',10000)
  self.assertEqual(self.e.db.execute("select sum(amount) from intents where kind='payment'").fetchone()[0],120000)
 def test_read_limit(self):
  self.enable()
  for i in range(60):self.e.reserve(uid(i+1),M['scenarios'][i//10]['id'],'read')
  with self.assertRaises(Denied):self.e.reserve(uid(99),'reference_mismatch','read')
 def test_replay_limit(self):
  self.enable()
  for i in range(3):self.e.reserve(uid(i+1),'duplicate_webhook','replay')
  with self.assertRaises(Denied):self.e.reserve(uid(99),'duplicate_webhook','replay')
 def test_interruption_no_second_send(self):
  self.enable()
  class Broken:
   evidence='mock'
   def perform(self,*args):raise TimeoutError()
  with self.assertRaises(TimeoutError):self.e.execute(uid(1),'success','payment',Broken(),10000)
  self.assertEqual(self.e.db.execute('select state from intents').fetchone()[0],'started')
  self.assertEqual(self.e.db.execute('select stopped from run').fetchone()[0],1)
  self.assertFalse(self.e.disposable())
 def test_single_init_profile_exactly_one(self):
  self.e.close();self.p=str(pathlib.Path(self.d.name)/'single.sqlite');self.e=Executor(self.p,S);self.enable()
  self.assertTrue(self.e.reserve(uid(1),'single_initialization','payment',10000,evidence='mock'))
  with self.assertRaises(Denied):self.e.reserve(uid(2),'single_initialization','payment',10000,evidence='mock')
  self.assertEqual(self.e.db.execute("select count(*) from intents where kind='payment'").fetchone()[0],1)
 def test_single_init_denies_refund_reconcile_read_and_replay(self):
  for i,kind in enumerate(('refund','read','replay')):
   with tempfile.TemporaryDirectory() as td:
    e=Executor(str(pathlib.Path(td)/'run.sqlite'),S);e.enable({'manifest_sha256':e.digest,'authorized':True,'environment':'test','evidence':'mock'},mock=True)
    with self.assertRaises(Denied):e.reserve(uid(10+i),'single_initialization',kind,10000 if kind=='refund' else 0,evidence='mock')
    self.assertEqual(e.db.execute('select stopped from run').fetchone()[0],1);e.close()
 def test_single_init_manifest_rejects_refund_budget_or_other_scenario(self):
  self.e.close()
  with self.assertRaises(Denied):Executor(self.p,{**S,'max_refund_initializations':1})
  with self.assertRaises(Denied):Executor(self.p,{**S,'scenarios':[{'id':'refund_processed','evidence':'real-provider','expected':'refund'}]})
if __name__=='__main__':unittest.main()
