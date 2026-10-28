const http=require('http'),https=require('https'),fs=require('fs');
const proxy=(req,res,host,path=req.url)=>{const r=http.request({hostname:host,port:3000,path,method:req.method,headers:{...req.headers,host}},x=>{if((req.socket.encrypted)){x.headers['content-security-policy']="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; frame-src 'none'; form-action 'self'; base-uri 'self'";x.headers['referrer-policy']='no-referrer';}res.writeHead(x.statusCode,x.headers);x.pipe(res);});r.on('error',()=>{res.writeHead(503);res.end('isolated_upstream_unavailable');});req.pipe(r);};
if(require.main===module)http.createServer((q,r)=>{
 if(!q.url.startsWith('/rest/v1/')){r.writeHead(404);return r.end();}
 const host=q.headers.host?.split(':')[0];
 if(!['backend-rest','office-data'].includes(host)){r.writeHead(403);return r.end();}
 proxy(q,r,host==='backend-rest'?'hardware-setup-backend-api':'hardware-setup-office-api',q.url.slice(8));
}).listen(3000,'0.0.0.0');
// This is the ONLY listener allowed behind the external tunnel. It holds no key, so it checks shape, not signatures:
// exact route, JSON content type, a well-formed Paystack signature header, a 64 KB body cap and a global rate limit.
// Only the headers the webhook handler needs are forwarded (no client, cookie or tunnel headers). Backend verifies the
// HMAC and treats the event as a hint; payment is confirmed only by a server-side verification read.
function webhookIngress({forward,max=30,windowMs=60000,limit=65536,now=Date.now}){
 let start=now(),n=0;
 return (q,r)=>{
  const deny=s=>{r.writeHead(s);r.end();q.resume();};
  if(q.method!=='POST'||q.url!=='/hardware-payments/webhook')return deny(404);
  const t=now();if(t-start>=windowMs){start=t;n=0;}if(++n>max)return deny(429);
  if(!/^application\/json(;\s*charset=utf-8)?$/i.test(q.headers['content-type']||'')||!/^[a-f0-9]{128}$/i.test(q.headers['x-paystack-signature']||''))return deny(400);
  // Content-Length is optional (chunked delivery); when present it must be sane and match the body.
  const declared=q.headers['content-length']===undefined?null:Number(q.headers['content-length']);if(declared!==null&&(!Number.isSafeInteger(declared)||declared<1||declared>limit))return deny(413);
  const chunks=[];let size=0,done=false;
  q.on('data',b=>{if(done)return;size+=b.length;if(size>limit){done=true;deny(413);q.destroy();}else chunks.push(b);});
  q.on('end',()=>{if(done)return;done=true;const body=Buffer.concat(chunks);if(!body.length||(declared!==null&&body.length!==declared))return deny(400);
   forward({'content-type':'application/json','content-length':String(body.length),'x-paystack-signature':q.headers['x-paystack-signature']},body,r);});
 };
}
const forwardWebhook=(headers,body,res)=>{const x=http.request({hostname:'hardware-setup-backend',port:3000,path:'/hardware-payments/webhook',method:'POST',headers:{...headers,host:'hardware-setup-backend'},timeout:15000},u=>{res.writeHead(u.statusCode,{'cache-control':'no-store'});res.end();u.resume();});x.on('timeout',()=>x.destroy());x.on('error',()=>{if(!res.headersSent){res.writeHead(503);res.end();}});x.end(body);};
if(require.main===module)http.createServer(webhookIngress({forward:forwardWebhook})).listen(4000,'0.0.0.0');
if(require.main===module){const tls={key:fs.readFileSync('/tls/key.pem'),cert:fs.readFileSync('/tls/cert.pem')};
https.createServer(tls,(q,r)=>{if(q.headers.host==='office.hardware.test'){if(q.url==='/backend/hardware-payments/initialize')return proxy(q,r,'hardware-setup-backend','/hardware-payments/initialize');if(q.url.startsWith('/backend/')){r.writeHead(404);return r.end();}return proxy(q,r,'hardware-setup-office');}if(!['localhost:18443','localhost'].includes(q.headers.host)){r.writeHead(403);return r.end();}proxy(q,r,'hardware-setup-getoyi');}).listen(443,'0.0.0.0');
https.createServer(tls,(q,r)=>proxy(q,r,'hardware-setup-office')).listen(444,'0.0.0.0');}
module.exports={webhookIngress};
