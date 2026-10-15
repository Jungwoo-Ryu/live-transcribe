const fs=require('node:fs'); const path=require('node:path'); const { spawnSync }=require('node:child_process');
let failures=0;
for(const folder of ['app','scripts','test']) {
  for(const f of fs.readdirSync(path.join(__dirname,'..',folder))) {
    if(!/\.(cjs|js)$/.test(f)) continue;
    const r=spawnSync(process.execPath,['--check',path.join(__dirname,'..',folder,f)],{ stdio:'inherit' });
    if(r.status!==0) failures++;
  }
}
process.exitCode=failures?1:0;
