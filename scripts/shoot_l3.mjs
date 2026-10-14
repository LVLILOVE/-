import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve('prototype');
const OUT = path.resolve('outputs/prototype-shots');
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml' };
const srv = await new Promise((res) => { const s = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p==='/') p='/index.html'; const f = path.join(ROOT, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, {'Content-Type': MIME[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(r); }); s.listen(0,'127.0.0.1',()=>res(s)); });
const port = srv.address().port, dbg = 9345;
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
const proc = spawn(EDGE, ['--headless=new',`--remote-debugging-port=${dbg}`,'--disable-gpu','--hide-scrollbars','--no-first-run','--window-size=1440,1000','about:blank'], {stdio:'ignore'});
async function cj(p){const r=await fetch(`http://127.0.0.1:${dbg}${p}`);const t=await r.text();try{return JSON.parse(t)}catch{throw new Error(t.slice(0,60))}}
let target; for(let i=0;i<60;i++){try{const l=await cj('/json/list');target=l.find(t=>t.type==='page');if(target)break}catch{} await new Promise(r=>setTimeout(r,300))}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r=>ws.onopen=r);
let id=0; const pend=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}};
const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}))});
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate',{url:`http://127.0.0.1:${port}/result.html`});
await new Promise(r=>setTimeout(r,2500));
// 点选第一个 L3 序列
const r = await send('Runtime.evaluate',{expression:`(function(){
  var items=[].slice.call(document.querySelectorAll('.sel-item'));
  for(var i=items.length-1;i>=0;i--){ if(items[i].querySelector('.dot-neutral')){ items[i].click(); return 'clicked idx '+i+' text '+items[i].textContent.trim().slice(0,30); } }
  return 'no-L3-found: '+items.length+' items';
})()`,returnByValue:true});
console.log(r.result.result.value);
await new Promise(r=>setTimeout(r,900));
const b = await send('Runtime.evaluate',{expression:`(function(){var el=document.querySelector('.card:has(#chart-host)');var box=el.getBoundingClientRect();return JSON.stringify({x:box.x+scrollX,y:box.y+scrollY,w:box.width,h:box.height})})()`,returnByValue:true});
const box = JSON.parse(b.result.result.value);
const shot = await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:box.x,y:box.y,width:box.w,height:box.h,scale:1}});
fs.writeFileSync(path.join(OUT,'result_l3.png'), Buffer.from(shot.result.data,'base64'));
console.log('✓ result_l3.png');
ws.close(); proc.kill(); srv.close(); process.exit(0);
