from pathlib import Path
import subprocess,shutil,tempfile
subprocess.run(['npm','run','build'],cwd='/Users/ochigaidoko/getoyi-work/backend-phase4e',check=True,stdout=open('/tmp/hardware-setup-compile.log','w'),stderr=subprocess.STDOUT)
root=Path('/Users/ochigaidoko/getoyi-work');stage=Path(tempfile.mkdtemp(prefix='hardware-setup-build-'))
for label,repo in [('backend','backend-phase4e'),('office','office-phase4e'),('getoyi','oyi-phase4e')]:
 source=root/repo;dest=stage/label;dest.mkdir()
 files=subprocess.check_output(['git','-C',str(source),'ls-files'],text=True).splitlines()
 for f in files:
  if any(x.startswith('.env') or x in ('.git','.vercel','.supabase','node_modules') for x in Path(f).parts):continue
  p=source/f
  if not p.is_file():continue
  q=dest/f;q.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,q)
 if label=='backend':shutil.copytree(source/'dist',dest/'dist')
(stage/'Dockerfile').write_text('''FROM node:22-bookworm-slim
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --ignore-scripts
COPY backend/ ./
WORKDIR /app/office
COPY office/package*.json ./
RUN npm ci --ignore-scripts
COPY office/ ./
WORKDIR /app/getoyi
COPY getoyi/package*.json ./
RUN npm ci --ignore-scripts
COPY getoyi/ ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
CMD ["node","/app/backend/dist/commerce/hardwareSetupServer.js"]
''')
r=subprocess.run(['docker','build','-t','getoyi-hardware-setup:local',str(stage)],stdout=open('/tmp/hardware-setup-image.log','w'),stderr=subprocess.STDOUT)
shutil.rmtree(stage)
raise SystemExit(r.returncode)
