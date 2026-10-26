"""Local durable run ledger. No credentials or network are opened by this module.
Adapters must implement the reviewed provider transport; mock evidence is explicit.
An interrupted POST is never retried: its intent stays uncertain until reconciled.
"""
import hashlib, json, os, re, sqlite3, time
from contextlib import contextmanager

class Denied(RuntimeError): pass

def canonical(v): return json.dumps(v,sort_keys=True,separators=(',',':'))

class Executor:
 def __init__(self,path,manifest):
  if manifest.get('environment')!='test' or manifest.get('currency')!='NGN': raise Denied('test_only')
  profile=manifest.get('execution_profile','full-suite')
  if profile not in ('full-suite','single-initialization-only'):raise Denied('execution_profile')
  limits={'max_payment_initializations':12,'max_payment_kobo':10000,'max_total_payment_kobo':120000,'max_refund_initializations':3,'max_refund_kobo':10000,'max_provider_reads':60,'max_webhook_replays':3,'max_duration_minutes':60}
  if profile=='single-initialization-only':
   limits.update(max_payment_initializations=1,max_total_payment_kobo=10000,max_refund_initializations=0,max_refund_kobo=0,max_provider_reads=0,max_webhook_replays=0,max_duration_minutes=30)
   for k,n in limits.items():
    value=manifest.get(k)
    if type(value) is not int or (value!=0 if k in ('max_refund_initializations','max_refund_kobo','max_provider_reads','max_webhook_replays') else not 0<value<=n): raise Denied('invalid_budget')
   if manifest.get('max_payment_initializations')!=1 or manifest.get('scenarios')!=[{'id':'single_initialization','evidence':'real-provider','expected':'initialization_only'}]:raise Denied('single_initialization_manifest')
  else:
   for k,n in limits.items():
    if type(manifest.get(k)) is not int or not 0<manifest[k]<=n: raise Denied('invalid_budget')
  expected={'success','declined','delayed_success','duplicate_webhook','redirect_only','amount_mismatch','reference_mismatch','expired_reservation','office_outage','refund_processed','refund_failed','refund_attention'}
  if profile=='full-suite' and (len(manifest.get('scenarios',[]))!=12 or {x.get('id') for x in manifest['scenarios']}!=expected):raise Denied('scenario_manifest')
  self.manifest=manifest;self.digest=hashlib.sha256(canonical(manifest).encode()).hexdigest()
  if os.path.islink(path): raise Denied('unsafe_ledger')
  fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600) if not os.path.exists(path) else None
  if fd is not None: os.close(fd)
  if os.stat(path).st_mode&0o777!=0o600: raise Denied('unsafe_ledger')
  self.db=sqlite3.connect(path,timeout=20,isolation_level=None);self.db.row_factory=sqlite3.Row
  self.db.executescript('''PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
CREATE TABLE IF NOT EXISTS run(id INTEGER PRIMARY KEY CHECK(id=1),manifest TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,stopped INTEGER NOT NULL DEFAULT 0,started REAL,mode TEXT);
CREATE TABLE IF NOT EXISTS intents(id TEXT PRIMARY KEY,scenario TEXT NOT NULL,kind TEXT NOT NULL,amount INTEGER NOT NULL,parent TEXT,state TEXT NOT NULL,evidence TEXT NOT NULL,created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY,event TEXT NOT NULL,intent TEXT,created REAL NOT NULL);
CREATE TRIGGER IF NOT EXISTS intents_no_delete BEFORE DELETE ON intents BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER IF NOT EXISTS intents_financial_immutable BEFORE UPDATE OF id,scenario,kind,amount,parent,evidence,created ON intents BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER IF NOT EXISTS run_manifest_immutable BEFORE UPDATE OF manifest ON run BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'immutable'); END;''')
  with self.tx():
   self.db.execute('INSERT OR IGNORE INTO run(id,manifest) VALUES(1,?)',(self.digest,))
   if self.db.execute('SELECT manifest FROM run').fetchone()[0]!=self.digest: raise Denied('manifest_changed')
 def close(self):self.db.close()
 @contextmanager
 def tx(self):
  self.db.execute('BEGIN IMMEDIATE')
  try:yield;self.db.execute('COMMIT')
  except BaseException:self.db.execute('ROLLBACK');raise
 def event(self,event,intent=None):self.db.execute('INSERT INTO events(event,intent,created) VALUES(?,?,?)',(event,intent,time.time()))
 def enable(self,approval,*,mock=False):
  # A separate, exact run authorization is mandatory. No environment defaults.
  if approval!={'manifest_sha256':self.digest,'authorized':True,'environment':'test','evidence':'mock' if mock else 'real-provider'}:raise Denied('explicit_authorization_required')
  with self.tx():
   if self.db.execute('SELECT stopped FROM run').fetchone()[0]:raise Denied('run_stopped')
   self.db.execute('UPDATE run SET enabled=1,started=COALESCE(started,?),mode=?',(time.time(),'mock' if mock else 'real-provider'));self.event('enabled_mock' if mock else 'enabled_provider')
 def stop(self,reason='mandatory_failure'):
  with self.tx():self.db.execute('UPDATE run SET enabled=0,stopped=1');self.event('stopped_'+reason)
 def disable(self):
  with self.tx():self.db.execute('UPDATE run SET enabled=0');self.event('disabled')
 def reserve(self,id,scenario,kind,amount=0,parent=None,evidence='mock'):
  try:
   with self.tx():
    r=self.db.execute('SELECT * FROM run').fetchone()
    if not r['enabled'] or r['stopped']:raise Denied('execution_disabled')
    if evidence!=r['mode']:raise Denied('evidence_mode_mismatch')
    if time.time()-r['started']>self.manifest['max_duration_minutes']*60:raise Denied('deadline')
    if not re.fullmatch(r'hwo_[a-f0-9]{32}',id):raise Denied('invalid_intent')
    scenarios={s['id'] for s in self.manifest['scenarios']}
    if scenario not in scenarios or kind not in ('payment','refund','read','replay') or evidence not in ('mock','real-provider','injected-fault'):raise Denied('invalid_scenario')
    if self.manifest.get('execution_profile')=='single-initialization-only' and (kind!='payment' or scenario!='single_initialization' or parent is not None or evidence not in ('mock','real-provider')):raise Denied('single_initialization_only')
    old=self.db.execute('SELECT * FROM intents WHERE id=?',(id,)).fetchone()
    if old:
     if (old['scenario'],old['kind'],old['amount'],old['parent'],old['evidence'])!=(scenario,kind,amount,parent,evidence):raise Denied('intent_conflict')
     return False # Includes started/uncertain intents. Never automatically re-POST.
    cap={'payment':'max_payment_initializations','refund':'max_refund_initializations','read':'max_provider_reads','replay':'max_webhook_replays'}[kind]
    count=self.db.execute('SELECT count(*) FROM intents WHERE kind=?',(kind,)).fetchone()[0]
    if count>=self.manifest[cap]:raise Denied('budget')
    # One initialization/refund per scenario, reads/replays bounded independently.
    per=1 if kind in ('payment','refund') else 10 if kind=='read' else 3
    if self.db.execute('SELECT count(*) FROM intents WHERE scenario=? AND kind=?',(scenario,kind)).fetchone()[0]>=per:raise Denied('scenario_budget')
    if kind in ('payment','refund'):
     if type(amount) is not int or not 0<amount<=self.manifest['max_payment_kobo' if kind=='payment' else 'max_refund_kobo']:raise Denied('amount')
    elif amount!=0:raise Denied('nonfinancial_amount')
    if kind=='payment' and self.db.execute("SELECT coalesce(sum(amount),0) FROM intents WHERE kind='payment'").fetchone()[0]+amount>self.manifest['max_total_payment_kobo']:raise Denied('aggregate')
    if kind=='refund':
     p=self.db.execute("SELECT * FROM intents WHERE id=? AND kind='payment' AND state='verified_success'",(parent,)).fetchone()
     if not p or p['amount']!=amount or p['evidence']!=evidence:raise Denied('full_verified_refund_required')
     if self.db.execute("SELECT count(*) FROM intents WHERE kind='refund' AND parent=?",(parent,)).fetchone()[0]:raise Denied('duplicate_refund')
    self.db.execute('INSERT INTO intents VALUES(?,?,?,?,?,?,?,?)',(id,scenario,kind,amount,parent,'started',evidence,time.time()));self.event('intent_reserved',id)
    return True
  except Denied as e:
   if str(e)!='execution_disabled':self.stop(str(e))
   raise
 def outcome(self,id,result):
  # Store no provider body, auth header, customer or URL. Validate binding before state.
  with self.tx():
   row=self.db.execute('SELECT * FROM intents WHERE id=?',(id,)).fetchone()
   if not row:raise Denied('unknown_intent')
   if row['state']!='started':return row['state']
   valid=(result.get('domain')=='test' and result.get('reference')==(row['parent'] if row['kind']=='refund' else id) and result.get('currency')=='NGN' and result.get('amount')==row['amount'] and result.get('evidence')==row['evidence'])
   state='verified_success' if valid and result.get('status')=='success' else 'verified_failure' if valid and result.get('status')=='failed' else 'uncertain'
   self.db.execute('UPDATE intents SET state=? WHERE id=?',(state,id));self.event(state,id)
   if not valid:self.db.execute('UPDATE run SET enabled=0,stopped=1');self.event('stopped_evidence_mismatch',id)
   return state
 def execute(self,id,scenario,kind,adapter,amount=0,parent=None):
  if not self.reserve(id,scenario,kind,amount,parent,adapter.evidence):return 'resume_requires_read_only_reconciliation'
  try:result=adapter.perform(kind,id,amount,parent)
  except BaseException:
   self.stop('interrupted_provider_operation');raise
  return self.outcome(id,result)
 def disposable(self):
  return not self.db.execute('SELECT count(*) FROM intents').fetchone()[0]
