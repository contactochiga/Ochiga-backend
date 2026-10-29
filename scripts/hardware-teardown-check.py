from pathlib import Path
import tempfile,json,subprocess,os
from unittest.mock import patch
source=(Path(__file__).resolve().parents[1]/'release/provider-setup/teardown.py').read_text()
for code,out in [(0,'1'),(1,'')]:
 with tempfile.TemporaryDirectory() as d:
  r=Path(d)/'runtime';r.mkdir();(r/'state.json').write_text(json.dumps({'containers':[],'network':'hardware-setup-private'}));(r/'tunnel.pid').write_text('123')
  calls=[]
  def fake(args,**kw):calls.append(args);return subprocess.CompletedProcess(args,code,out,'')
  with patch('subprocess.run',side_effect=fake),patch('os.kill',side_effect=AssertionError('must not stop webhook')):
   try:exec(compile(source,'teardown.py','exec'),{'__file__':str(Path(d)/'teardown.py')})
   except SystemExit:pass
   else:raise AssertionError('must refuse cleanup')
  assert all('rm' not in c and 'ps' not in c for c in calls)
print('2 financial-preservation teardown checks PASS')
