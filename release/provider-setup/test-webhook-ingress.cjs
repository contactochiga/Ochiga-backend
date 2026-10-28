'use strict';
// Gateway webhook ingress (the only listener behind the external tunnel). Loopback sockets and a stub upstream only.
const assert=require('node:assert/strict'),http=require('http'),net=require('net');
const {webhookIngress}=require('./gateway.cjs');
let n=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);n++;};
(async()=>{
 const forwarded=[];let t=0;
 const ingress=webhookIngress({forward:(headers,body,res)=>{forwarded.push({headers,body:body.toString()});res.writeHead(200);res.end();},max:6,windowMs:60000,limit:1024,now:()=>t});
 const server=http.createServer(ingress).listen(0,'127.0.0.1');await new Promise(x=>server.once('listening',x));const port=server.address().port;
 const sig='a'.repeat(128),body=JSON.stringify({event:'charge.success',data:{reference:'hwo_'+'a'.repeat(32)}});
 const send=(o={})=>new Promise(res=>{const h={'content-type':'application/json','x-paystack-signature':sig,'cookie':'secret=1','cf-connecting-ip':'198.51.100.7',...(o.headers||{})};
  for(const k of Object.keys(h))if(h[k]===undefined)delete h[k];
  const q=http.request({agent:false,host:'127.0.0.1',port,method:o.method||'POST',path:o.path||'/hardware-payments/webhook',headers:h},r=>{r.resume();r.on('end',()=>res(r.statusCode));});q.on('error',()=>res('reset'));q.end(o.body===undefined?body:o.body);});
 eq(await send(),200,'well-formed signed-shape delivery forwarded');
 eq(forwarded[0].headers,{'content-type':'application/json','content-length':String(Buffer.byteLength(body)),'x-paystack-signature':sig},'only the required headers are forwarded');
 eq(forwarded[0].body,body,'body forwarded byte-identical');
 for(const [o,s,m] of [
  [{path:'/hardware-payments/webhook?x=1'},404,'query string refused'],
  [{path:'/hardware-payments/initialize'},404,'other Backend routes unreachable'],
  [{method:'GET',body:''},404,'GET refused'],
  [{headers:{'x-paystack-signature':'bad'}},400,'malformed signature header refused'],
  [{headers:{'x-paystack-signature':undefined}},400,'missing signature refused'],
  [{headers:{'content-type':'text/plain'}},400,'non-JSON refused'],
 ])eq(await send(o),s,m);
 t=60000;  // new window
 eq(await send({body:'x'.repeat(2000)}),413,'declared oversize refused');
 // Chunked body without Content-Length larger than the cap is cut off.
 const chunked=await new Promise(res=>{const q=http.request({agent:false,host:'127.0.0.1',port,method:'POST',path:'/hardware-payments/webhook',headers:{'content-type':'application/json','x-paystack-signature':sig,'transfer-encoding':'chunked'}},r=>{r.resume();r.on('end',()=>res(r.statusCode));});q.on('error',()=>res('reset'));q.write('x'.repeat(800));q.end('x'.repeat(800));});
 assert.ok(chunked===413||chunked==='reset','chunked oversize refused');n++;
 eq(await new Promise(res=>{const q=http.request({agent:false,host:'127.0.0.1',port,method:'POST',path:'/hardware-payments/webhook',headers:{'content-type':'application/json','x-paystack-signature':sig,'transfer-encoding':'chunked'}},r=>{r.resume();r.on('end',()=>res(r.statusCode));});q.on('error',()=>res('reset'));q.end(body);}),200,'chunked delivery within the cap forwarded');
 // Rate limit: at most 6 per window, refused before any forwarding.
 const before=forwarded.length,codes=[];for(let i=0;i<6;i++)codes.push(await send());
 eq(codes.filter(c=>c===429).length,3,'requests beyond the window budget get 429');eq(forwarded.length-before,3);
 eq(forwarded.length,5,'only well-formed, in-budget deliveries reached Backend');
 await new Promise(x=>server.close(x));
 console.log(`gateway webhook ingress: ${n} assertions PASS; loopback only, stub upstream`);
})().catch(e=>{console.error(e);process.exitCode=1;});
