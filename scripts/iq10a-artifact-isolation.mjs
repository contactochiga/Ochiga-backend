// Test-output routing only. Preserve frozen artifacts when old tests regenerate reports.
import fs from 'node:fs';
import path from 'node:path';
const prefix=process.env.WAVE11_HARNESS_OUT;
if(!prefix?.startsWith('/tmp/'))throw Error('Isolated test output prefix required');
const write=fs.writeFileSync.bind(fs);
fs.writeFileSync=(file,...args)=>{
 const relative=typeof file==='string'?path.relative(process.cwd(),path.resolve(file)):'';
 return write(relative.startsWith('artifacts/')?`${prefix}-${path.basename(relative)}`:file,...args);
};
