const http=require('http'),https=require('https'),fs=require('fs');
const proxy=(req,res,host,path=req.url)=>{const r=http.request({hostname:host,port:3000,path,method:req.method,headers:{...req.headers,host}},x=>{if((req.socket.encrypted)){x.headers['content-security-policy']="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; frame-src 'none'; form-action 'self'; base-uri 'self'";x.headers['referrer-policy']='no-referrer';}res.writeHead(x.statusCode,x.headers);x.pipe(res);});r.on('error',()=>{res.writeHead(503);res.end('isolated_upstream_unavailable');});req.pipe(r);};
http.createServer((q,r)=>{
 if(!q.url.startsWith('/rest/v1/')){r.writeHead(404);return r.end();}
 const host=q.headers.host?.split(':')[0];
 if(!['backend-rest','office-data'].includes(host)){r.writeHead(403);return r.end();}
 proxy(q,r,host==='backend-rest'?'hardware-setup-backend-api':'hardware-setup-office-api',q.url.slice(8));
}).listen(3000,'0.0.0.0');
// This is the ONLY listener allowed behind the external tunnel.
http.createServer((q,r)=>{if(q.method!=='POST'||q.url!=='/hardware-payments/webhook'){r.writeHead(404);return r.end();}proxy(q,r,'hardware-setup-backend');}).listen(4000,'0.0.0.0');
const tls={key:fs.readFileSync('/tls/key.pem'),cert:fs.readFileSync('/tls/cert.pem')};
https.createServer(tls,(q,r)=>{if(q.headers.host==='office.hardware.test')return proxy(q,r,'hardware-setup-office');if(!['localhost:18443','localhost'].includes(q.headers.host)){r.writeHead(403);return r.end();}proxy(q,r,'hardware-setup-getoyi');}).listen(443,'0.0.0.0');
https.createServer(tls,(q,r)=>proxy(q,r,'hardware-setup-office')).listen(444,'0.0.0.0');
