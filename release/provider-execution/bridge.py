"""Private stdin/stdout budget bridge. No provider body or credential crosses this boundary."""
import sys,json,os,hashlib,time,sqlite3,secrets
from executor import Executor,Denied,canonical

def main(q):
 path=q['database'];manifest=q['manifest']
 # Execution must never recreate missing state or migrate a damaged ledger.
 if not os.path.isfile(path) or os.path.islink(path):raise Denied('execution_state_missing')
 probe=sqlite3.connect('file:'+path+'?mode=ro',uri=True)
 tables={r[0] for r in probe.execute("select name from sqlite_master where type='table'")};triggers={r[0] for r in probe.execute("select name from sqlite_master where type='trigger'")};integrity=probe.execute('PRAGMA integrity_check').fetchone()[0];probe.close()
 if integrity!='ok' or not {'events_no_update','events_no_delete','intents_no_delete','intents_financial_immutable','run_manifest_immutable'}.issubset(triggers):raise Denied('execution_state_inconsistent')
 if not {'run','intents','events'}.issubset(tables):raise Denied('execution_state_inconsistent')
 e=Executor(path,manifest)
 try:
  if q['action']=='prepare':
   plan=q['plan'];scenarios={s['id'] for s in manifest['scenarios']}
   if not 1<=len(plan)<=12 or len({p['reference'] for p in plan})!=len(plan):raise Denied('invalid_plan')
   import re
   for p in plan:
    if set(p)!={'reference','scenario','amount'} or not re.fullmatch('hwo_[a-f0-9]{32}',p['reference']) or p['scenario'] not in scenarios or type(p['amount']) is not int or not 0<p['amount']<=10000:raise Denied('invalid_plan')
   with e.tx():
    if not e.disposable() or e.db.execute('select enabled from run').fetchone()[0]:raise Denied('plan_already_started')
    e.db.execute('CREATE TABLE IF NOT EXISTS execution_plan(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL)')
    e.db.execute('CREATE TABLE IF NOT EXISTS wire_tickets(token_hash TEXT PRIMARY KEY,intent TEXT NOT NULL,reference TEXT NOT NULL,request_hash TEXT NOT NULL,consumed INTEGER NOT NULL DEFAULT 0)')
    e.db.execute("CREATE TRIGGER IF NOT EXISTS plan_immutable BEFORE UPDATE ON execution_plan BEGIN SELECT RAISE(ABORT,'immutable'); END")
    e.db.execute("CREATE TRIGGER IF NOT EXISTS plan_no_delete BEFORE DELETE ON execution_plan BEGIN SELECT RAISE(ABORT,'immutable'); END")
    old=e.db.execute('SELECT value FROM execution_plan').fetchone();value=canonical(plan)
    if old and old[0]!=value:raise Denied('plan_changed')
    e.db.execute('INSERT OR IGNORE INTO execution_plan VALUES(1,?)',(value,));e.event('plan_registered')
   return {'plan_sha256':hashlib.sha256(value.encode()).hexdigest()}
  row=e.db.execute('SELECT value FROM execution_plan WHERE id=1').fetchone()
  if not row:raise Denied('execution_plan_missing')
  plan=json.loads(row[0]);digest=hashlib.sha256(row[0].encode()).hexdigest()
  if digest!=q.get('plan_sha256'):raise Denied('plan_mismatch')
  if q['action']=='arm':
   if q.get('approval',{}).get('plan_sha256')!=digest:raise Denied('explicit_plan_approval_required')
   approval={k:v for k,v in q['approval'].items() if k!='plan_sha256'}
   e.enable(approval,mock=q['mode']=='mock');return {'armed':True}
  if q['action']=='stop':e.stop(q.get('reason','mandatory_failure'));return {'stopped':True}
  if q['action']=='disable':e.disable();return {'disabled':True}
  r=e.db.execute('SELECT * FROM run').fetchone()
  if not r['enabled'] or r['stopped'] or r['mode']!=q['mode']:raise Denied('execution_disabled')
  if time.time()-r['started']>manifest['max_duration_minutes']*60:e.stop('deadline');raise Denied('deadline')
  if q['action']=='plan':return plan
  item=next((p for p in plan if p['reference']==q.get('reference')),None)
  if not item:raise Denied('reference_outside_plan')
  # Budget state must match its immutable reservation trail.
  if e.db.execute('select count(*) from intents').fetchone()[0]!=e.db.execute("select count(*) from events where event='intent_reserved'").fetchone()[0]:e.stop('state_inconsistent');raise Denied('state_inconsistent')
  if q['action']=='check':return item
  if q['action']=='consume':
   with e.tx():
    token_hash=hashlib.sha256(q['ticket'].encode()).hexdigest()
    t=e.db.execute('SELECT * FROM wire_tickets WHERE token_hash=?',(token_hash,)).fetchone()
    if not t or t['consumed'] or t['reference']!=item['reference'] or t['request_hash']!=q['request_hash']:raise Denied('invalid_or_consumed_ticket')
    e.db.execute('UPDATE wire_tickets SET consumed=1 WHERE token_hash=?',(token_hash,));e.event('wire_dispatch',t['intent'])
   return {'dispatch':True}
  if q['action']=='claim':
   kind=q['kind'];amount=q.get('amount',0)
   if kind in ('payment','refund') and amount!=item['amount']:e.stop('amount_mismatch');raise Denied('amount_mismatch')
   if kind in ('payment','refund') and e.db.execute("select count(*) from intents where state in ('started','uncertain') and kind in ('payment','refund')").fetchone()[0]:raise Denied('read_only_recovery_required')
   fresh=e.reserve(q['id'],item['scenario'],kind,amount,q.get('parent'),q['mode'])
   if not fresh:raise Denied('financial_operation_already_reserved')
   if q.get('request_hash'):
    import re
    if not re.fullmatch('[a-f0-9]{64}',q['request_hash']):raise Denied('invalid_request_hash')
    ticket=secrets.token_hex(32)
    with e.tx():e.db.execute('INSERT INTO wire_tickets VALUES(?,?,?,?,0)',(hashlib.sha256(ticket.encode()).hexdigest(),q['id'],item['reference'],q['request_hash']))
    return {'reserved':True,'ticket':ticket}
   return {'reserved':True}
  if q['action']=='record':
   if q['state'] not in ('returned','uncertain','verified_success','verified_failure'):raise Denied('invalid_observation')
   with e.tx():
    intent=e.db.execute('SELECT * FROM intents WHERE id=?',(q['id'],)).fetchone()
    if not intent or intent['scenario']!=item['scenario']:raise Denied('unknown_observation')
    if intent['state']=='verified_success' and q['state']!='verified_success':raise Denied('conflicting_observation')
    e.db.execute('UPDATE intents SET state=? WHERE id=?',(q['state'],q['id']));e.event('wire_'+q['state'],q['id'])
   return {'recorded':True}
  raise Denied('unknown_command')
 finally:e.close()
if __name__=='__main__':
 try:print(json.dumps({'ok':True,'result':main(json.load(sys.stdin))}))
 except Exception as ex:
  # Exception arguments may contain caller data; expose only enumerated local error strings.
  safe=str(ex) if isinstance(ex,Denied) else 'execution_state_unavailable'
  print(json.dumps({'ok':False,'error':safe}));sys.exit(1)
