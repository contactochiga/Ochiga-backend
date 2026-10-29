import unittest,tempfile,pathlib,json,sys,concurrent.futures,hashlib
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from executor import Executor,Denied
from bridge import main
M=json.loads((pathlib.Path(__file__).parent.parent/'provider-preparation/run-manifest.json').read_text())
S=json.loads((pathlib.Path(__file__).parent/'single-init-manifest.json').read_text())
class BridgeTests(unittest.TestCase):
 def setUp(self):
  self.d=tempfile.TemporaryDirectory();self.path=str(pathlib.Path(self.d.name)/'run.sqlite');self.e=Executor(self.path,M);self.ref='hwo_'+'a'*32
  self.q=dict(database=self.path,manifest=M,mode='mock');self.q['plan_sha256']=main({**self.q,'action':'prepare','plan':[dict(reference=self.ref,scenario='success',amount=10000)]})['plan_sha256']
  main({**self.q,'action':'arm','approval':dict(manifest_sha256=self.e.digest,plan_sha256=self.q['plan_sha256'],authorized=True,environment='test',evidence='mock')})
 def tearDown(self):self.e.close();self.d.cleanup()
 def ticket(self):return main({**self.q,'action':'claim','reference':self.ref,'id':self.ref,'kind':'payment','amount':10000,'request_hash':'b'*64})['ticket']
 def test_preflight_disabled_only(self):
  with self.assertRaises(Denied):main({**self.q,'action':'preflight-plan'})
  main({**self.q,'action':'disable'})
  before=self.e.db.total_changes
  self.assertEqual(len(main({**self.q,'action':'preflight-plan'})),1)
  self.assertEqual(self.e.db.total_changes,before)
  with self.assertRaises(Denied):main({**self.q,'action':'plan'})
 def test_status_is_read_only_and_redacted(self):
  before=self.e.db.total_changes
  status=main({**self.q,'action':'status'})
  self.assertEqual(self.e.db.total_changes,before)
  self.assertEqual(status['intent_count'],0)
  self.assertEqual(status['dispatch_ticket_count'],0)
  self.assertEqual(status['provider_dispatch_count'],0)
  self.assertTrue(status['run_enabled'])
  self.assertFalse({'reference','order_id','amount','secret','url'} & set(status))
 def test_ticket_concurrency(self):
  ticket=self.ticket()
  def go(_):
   try:main({**self.q,'action':'consume','reference':self.ref,'ticket':ticket,'request_hash':'b'*64});return 1
   except Denied:return 0
  with concurrent.futures.ThreadPoolExecutor(max_workers=8) as p:self.assertEqual(sum(p.map(go,range(12))),1)
 def test_hash_binding(self):
  with self.assertRaises(Denied):main({**self.q,'action':'consume','reference':self.ref,'ticket':self.ticket(),'request_hash':'c'*64})
 def test_missing(self):
  with self.assertRaises(Denied):main({**self.q,'database':self.path+'missing','action':'plan'})
  self.assertFalse(pathlib.Path(self.path+'missing').exists())
 def test_schema_tamper(self):
  self.e.db.execute('DROP TRIGGER intents_no_delete')
  with self.assertRaises(Denied):main({**self.q,'action':'plan'})
 def test_counter_mutation(self):
  self.ticket()
  with self.assertRaises(Exception):self.e.db.execute('UPDATE intents SET amount=1')
  with self.assertRaises(Exception):self.e.db.execute('DELETE FROM intents')
 def test_approved_plan_binding(self):
  with self.assertRaises(Denied):main({**self.q,'action':'plan','plan_sha256':'0'*64})
 def test_uncertain_read_only(self):
  self.ticket();main({**self.q,'action':'record','reference':self.ref,'id':self.ref,'state':'uncertain'})
  with self.assertRaises(Denied):main({**self.q,'action':'claim','reference':self.ref,'id':'hwo_'+'c'*32,'kind':'payment','amount':10000})
  self.assertTrue(main({**self.q,'action':'claim','reference':self.ref,'id':'hwo_'+'d'*32,'kind':'read','amount':0})['reserved'])
 def test_single_plan_only_one_fresh_init(self):
  p=str(pathlib.Path(self.d.name)/'single.sqlite');e=Executor(p,S);ref='hwo_'+'e'*32;q=dict(database=p,manifest=S,mode='real-provider')
  plan=[dict(reference=ref,scenario='single_initialization',amount=10000)]
  digest=main({**q,'action':'prepare','plan':plan})['plan_sha256'];q['plan_sha256']=digest
  self.assertEqual(main({**q,'action':'preflight-plan'}),plan)
  with self.assertRaises(Denied):main({**q,'action':'prepare','plan':plan+[dict(reference='hwo_'+'f'*32,scenario='single_initialization',amount=10000)]})
  q['mode']='mock';main({**q,'action':'arm','approval':dict(manifest_sha256=e.digest,plan_sha256=digest,authorized=True,environment='test',evidence='mock')})
  with self.assertRaises(Denied):main({**q,'action':'claim','reference':ref,'id':ref,'kind':'refund','scenario':'single_initialization','amount':10000,'request_hash':'a'*64})
  e.close()
 def test_single_uncertain_stops_and_cannot_claim_again(self):
  p=str(pathlib.Path(self.d.name)/'single-uncertain.sqlite');e=Executor(p,S);ref='hwo_'+'a'*32;q=dict(database=p,manifest=S,mode='mock')
  digest=main({**q,'action':'prepare','plan':[dict(reference=ref,scenario='single_initialization',amount=10000)]})['plan_sha256'];q['plan_sha256']=digest
  main({**q,'action':'arm','approval':dict(manifest_sha256=e.digest,plan_sha256=digest,authorized=True,environment='test',evidence='mock')})
  main({**q,'action':'claim','reference':ref,'id':ref,'kind':'payment','scenario':'single_initialization','amount':10000,'request_hash':'b'*64})
  main({**q,'action':'record','reference':ref,'id':ref,'state':'uncertain'})
  self.assertEqual(tuple(e.db.execute('select enabled,stopped from run').fetchone()),(0,1))
  with self.assertRaises(Denied):main({**q,'action':'claim','reference':ref,'id':ref,'kind':'payment','scenario':'single_initialization','amount':10000,'request_hash':'b'*64})
  self.assertEqual(e.db.execute('select count(*) from intents').fetchone()[0],1);e.close()
 def test_single_returned_initialization_is_terminal(self):
  p=str(pathlib.Path(self.d.name)/'single-returned.sqlite');e=Executor(p,S);ref='hwo_'+'b'*32;q=dict(database=p,manifest=S,mode='mock')
  digest=main({**q,'action':'prepare','plan':[dict(reference=ref,scenario='single_initialization',amount=10000)]})['plan_sha256'];q['plan_sha256']=digest
  main({**q,'action':'arm','approval':dict(manifest_sha256=e.digest,plan_sha256=digest,authorized=True,environment='test',evidence='mock')})
  main({**q,'action':'claim','reference':ref,'id':ref,'kind':'payment','scenario':'single_initialization','amount':10000,'request_hash':'c'*64})
  main({**q,'action':'record','reference':ref,'id':ref,'state':'returned'})
  self.assertEqual(tuple(e.db.execute('select enabled,stopped from run').fetchone()),(0,1));e.close()
 def test_single_interrupted_start_cannot_get_second_ticket(self):
  p=str(pathlib.Path(self.d.name)/'single-interrupted.sqlite');e=Executor(p,S);ref='hwo_'+'c'*32;q=dict(database=p,manifest=S,mode='mock')
  digest=main({**q,'action':'prepare','plan':[dict(reference=ref,scenario='single_initialization',amount=10000)]})['plan_sha256'];q['plan_sha256']=digest
  main({**q,'action':'arm','approval':dict(manifest_sha256=e.digest,plan_sha256=digest,authorized=True,environment='test',evidence='mock')})
  first=main({**q,'action':'claim','reference':ref,'id':ref,'kind':'payment','scenario':'single_initialization','amount':10000,'request_hash':'d'*64})
  self.assertTrue(first.get('ticket'));e.close();e=Executor(p,S)
  with self.assertRaises(Denied):main({**q,'action':'claim','reference':ref,'id':ref,'kind':'payment','scenario':'single_initialization','amount':10000,'request_hash':'d'*64})
  self.assertEqual(tuple(e.db.execute('select enabled,stopped from run').fetchone()),(0,1));self.assertEqual(e.db.execute('select count(*) from intents').fetchone()[0],1);e.close()
if __name__=='__main__':unittest.main()
