from pathlib import Path
import subprocess,secrets,json,os
R=Path(__file__).resolve().parent/'runtime'
if not (R/'state.json').exists():raise SystemExit('Isolated setup required')
p=R/'staff-credentials.json'
if p.exists():raise SystemExit('Synthetic staff already seeded')
records=[];statements=['begin;']
for name,scopes in [('requester',['commerce.orders.read','commerce.orders.refund.request','catalogue.read','catalogue.write']),('reviewer',['commerce.orders.read','commerce.orders.refund.approve','catalogue.read','catalogue.review'])]:
 password=secrets.token_urlsafe(30);email='setup-'+name+'@example.invalid'
 code="let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>process.stdout.write(require('/app/office/src/lead-agents/auth').hashPassword(s)));"
 hashed=subprocess.run(['docker','exec','-i','hardware-setup-office','node','-e',code],input=password,text=True,capture_output=True,check=True).stdout
 quote=lambda s:"'"+s.replace("'","''")+"'"
 statements.append("insert into admin_users(email,password_hash,role,status,permission_scopes) values("+quote(email)+','+quote(hashed)+",'ochiga_staff','active',array["+','.join(quote(x) for x in scopes)+"]);")
 records.append({'email':email,'password':password})
statements.append("select catalogue_create_product('synthetic-setup-draft',(select id from catalogue_categories order by sort limit 1),null,'{\"name\":\"ZZ SYNTHETIC SETUP ONLY — NOT FOR SALE\",\"variants\":[{\"sku\":\"SETUP-NOT-FOR-SALE\",\"name\":\"Synthetic draft\"}]}','setup-requester@example.invalid');")
statements.append('commit;')
r=subprocess.run(['docker','exec','-i','hardware-setup-office-db','psql','-X','-Atq','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],input='\n'.join(statements),text=True,capture_output=True)
if r.returncode:raise SystemExit('Synthetic seed failed: '+r.stderr[:150])
fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:json.dump(records,f)
print('Two synthetic non-admin staff and one unpublished draft seeded; no payment/order/publication created')
