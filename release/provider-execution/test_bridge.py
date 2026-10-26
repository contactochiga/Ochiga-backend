import unittest,tempfile,pathlib,json,sys,concurrent.futures,hashlib
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from executor import Executor,Denied
from bridge import main
M=json.loads((pathlib.Path(__file__).parent.parent/'provider-preparation/run-manifest.json').read_text())
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
if __name__=='__main__':unittest.main()
