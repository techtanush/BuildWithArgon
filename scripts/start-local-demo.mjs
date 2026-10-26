import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
async function ready(){try{const r=await fetch('http://127.0.0.1:15182/health',{signal:AbortSignal.timeout(1500)});return r.ok;}catch{return false;}}
if(await ready()){console.log('YCBF already running: http://127.0.0.1:15182/');process.exit(0);}
const dir=path.join(root,'.local-preview');fs.mkdirSync(dir,{recursive:true});
const log=fs.openSync(path.join(dir,'ui-server.log'),'a',0o600);
const child=spawn(process.execPath,[path.join(root,'scripts/local-demo.mjs'),'--local-demo'],{cwd:root,detached:true,stdio:['ignore',log,log]});
child.on('error',()=>{console.error('UI service could not start. Run node scripts/local-demo.mjs --local-demo in Terminal.');process.exitCode=1;});
child.unref();fs.closeSync(log);
if(child.pid)fs.writeFileSync(path.join(dir,'ui-server.pid'),String(child.pid)+'\n',{mode:0o600});
for(let n=0;n<25;n++){if(await ready()){console.log('YCBF is responding: http://127.0.0.1:15182/');process.exit(0);}await new Promise(r=>setTimeout(r,500));}
console.error('UI service not ready yet. Inspect the local ui-server.log without sharing credentials.');process.exitCode=1;
