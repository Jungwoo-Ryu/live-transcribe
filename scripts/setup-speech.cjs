const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const root=path.resolve(__dirname,'..');
const candidates=process.platform==='win32' ? [['py',['-3']],['python',[]]] : [['python3',[]],['python',[]]];
let selected;
for(const [exe,args] of candidates) {
  const r=spawnSync(exe,[...args,'-c','import sys; assert (3,10) <= sys.version_info[:2] <= (3,13)'],{ stdio:'ignore' });
  if(r.status===0) { selected=[exe,args]; break; }
}
if(!selected) { console.error('Install Python 3.10–3.13 (3.12 recommended), including pip, then run this command again.'); process.exit(1); }
function run(exe,args) {
  const r=spawnSync(exe,args,{ stdio:'inherit',cwd:root,windowsHide:true });
  if(r.error || r.status!==0) { console.error(r.error?.message || 'Setup failed. See the output above.'); process.exit(r.status || 1); }
}
const venv=path.join(root,'.venv');
const python=process.platform==='win32'?path.join(venv,'Scripts','python.exe'):path.join(venv,'bin','python');
if(!fs.existsSync(python)) run(selected[0],[...selected[1],'-m','venv',venv]);
run(python,['-m','pip','install','--upgrade','pip']);
run(python,['-m','pip','install','-r',path.join(root,'python','requirements.txt')]);
console.log('\nSpeech installed. Open the app → Setup → Prepare speech model. The first preparation downloads weights.');
