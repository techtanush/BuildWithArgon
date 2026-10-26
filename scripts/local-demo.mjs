import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {parseEnv} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import http from 'node:http';
const root=fileURLToPath(new URL('../',import.meta.url)),web=path.join(root,'argon-app/web'),out=path.join(root,'.local-preview/portable-ui');
const demo=process.argv.includes('--local-demo');
const req=createRequire(path.join(web,'package.json')),vr=createRequire(req.resolve('vite/package.json')),compiler=vr('esbuild');
let env={};try{env=parseEnv(await fs.readFile(path.join(root,'argon-app/.env'),'utf8'));}catch{}
const token=process.env.KERNEL_TOKEN||env.KERNEL_TOKEN;
if(!token)throw Error('Configure the server-side kernel token before starting this local proxy.');
await fs.mkdir(out,{recursive:true});
const glob={name:'capture-static-glob',setup(build){build.onLoad({filter:/CapturePage\.tsx$/},async args=>{let s=await fs.readFile(args.path,'utf8');let files=[];try{files=(await fs.readdir(path.join(web,'src/world/buildings/staging'))).filter(f=>f.endsWith('.ts'));}catch{}const map='{'+files.map(f=>{const p='../buildings/staging/'+f;return JSON.stringify(p)+':()=>import('+JSON.stringify(p)+')';}).join(',')+'}';s=s.replace(/import\.meta\.glob<\{\s*default:\s*BuildingModule\s*\}>\(\s*["']\.\.\/buildings\/staging\/\*\.ts["'],?\s*\)/,map);return{contents:s,loader:'tsx'};});}};
console.log('Building updated YCBF UI with the portable transformer…');
await compiler.build({absWorkingDir:web,entryPoints:['src/main.tsx'],outdir:out,entryNames:'main',bundle:true,format:'esm',platform:'browser',target:'es2022',splitting:true,minify:false,sourcemap:false,jsx:'automatic',loader:{'.svg':'file','.png':'file','.jpg':'file','.webp':'file','.woff2':'file'},define:{'import.meta.env':JSON.stringify({DEV:true,PROD:false,MODE:'development',BASE_URL:'/',VITE_ENABLE_LOCAL_DEMO:demo?'true':'false',VITE_CLERK_PUBLISHABLE_KEY:process.env.VITE_CLERK_PUBLISHABLE_KEY||''})},plugins:[glob],logLevel:'warning'});
let index=await fs.readFile(path.join(web,'index.html'),'utf8');index=index.replace('<script type="module" src="/src/main.tsx"></script>','<link rel="stylesheet" href="/app/main.css"><script type="module" src="/app/main.js"></script>');
if(process.argv.includes('--build-only')){console.log('Updated local UI bundle rebuilt.');process.exit(0);}
const types={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.hdr':'application/octet-stream','.glb':'model/gltf-binary','.wasm':'application/wasm','.woff2':'font/woff2'};
const server=http.createServer(async(q,s)=>{s.on('error',()=>{});const fail=(code,message)=>{if(s.destroyed||s.writableEnded)return;if(s.headersSent){s.destroy();return;}s.writeHead(code,{'content-type':'application/json'});s.end(JSON.stringify({error:{message}}));};try{
 const host=q.headers.host;if(!['127.0.0.1:15182','localhost:15182'].includes(host)){s.writeHead(403);s.end('Untrusted host');return;}
 if(q.headers.origin&&!['http://127.0.0.1:15182','http://localhost:15182'].includes(q.headers.origin)){s.writeHead(403);s.end('Untrusted origin');return;}
 const u=new URL(q.url,'http://'+host);if(u.origin!=='http://'+host){s.writeHead(403);s.end();return;}
 if(/^\/(v1\/|preview\/|media\/|health$|openapi\.json$)/.test(u.pathname)){
  const headers={...q.headers,host:'127.0.0.1:18790',authorization:'Bearer '+token};for(const k of Object.keys(headers))if(k.startsWith('x-ycbf-')||k.startsWith('x-foundry-'))delete headers[k];
  const p=http.request({hostname:'127.0.0.1',port:18790,path:u.pathname+u.search,method:q.method,headers},r=>{r.on('error',()=>{if(!s.destroyed)s.destroy();});if(s.destroyed){r.destroy();return;}s.writeHead(r.statusCode||502,{...r.headers,'x-content-type-options':'nosniff'});r.pipe(s);});p.on('error',()=>fail(502,'The local API is unavailable. Please retry once it is running.'));q.on('aborted',()=>p.destroy());q.on('error',()=>p.destroy());s.on('close',()=>{if(!s.writableEnded)p.destroy();});q.pipe(p);return;
 }
 let base,rel;if(u.pathname.startsWith('/app/')){base=out;rel=decodeURIComponent(u.pathname.slice(5));}else if(u.pathname.startsWith('/assets/')||u.pathname.startsWith('/generated/')||u.pathname==='/ycbf-mark.svg'){base=path.join(web,'public');rel=decodeURIComponent(u.pathname.slice(1));}else{s.writeHead(200,{'content-type':'text/html;charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});s.end(index);return;}
 if(rel.split('/').some(x=>x==='..'||x.startsWith('.'))){s.writeHead(403);s.end();return;}const file=path.resolve(base,rel),real=await fs.realpath(file);if(!real.startsWith(base+path.sep)){s.writeHead(403);s.end();return;}const b=await fs.readFile(real);s.writeHead(200,{'content-type':types[path.extname(real)]||'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff'});s.end(b);
 }catch{if(!s.destroyed&&!s.writableEnded){if(!s.headersSent)s.writeHead(404);s.end('Not found');}}});
server.listen(15182,'127.0.0.1',()=>console.log('Updated YCBF: http://127.0.0.1:15182/demo (explicit local demo; not hosted account access).'));
