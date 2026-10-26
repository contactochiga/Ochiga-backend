'use strict';
// Preparation-only relay: fixed Paystack TLS destination, no credentials, no transactions.
const http=require('http'),https=require('https'),dns=require('dns').promises,{execFileSync}=require('child_process');
async function main(){
 if(process.env.PROVIDER_PREPARATION_ONLY!=='true')throw Error('preparation_mode_required');
 for(const k of Object.keys(process.env))if(/SECRET|API_KEY|TOKEN|PASSWORD/.test(k))throw Error('credential_not_allowed_in_preparation');
 const addresses=(await dns.resolve4('api.paystack.co')).filter(ip=>! /^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|198\.(18|19)\.|22[4-9]\.|2[3-5]\d\.)/.test(ip));
 if(!addresses.length)throw Error('provider_dns_invalid');
 const ipt=(...a)=>execFileSync('iptables',a,{stdio:'ignore'});
 ipt('-P','OUTPUT','DROP');ipt('-A','OUTPUT','-m','conntrack','--ctstate','ESTABLISHED,RELATED','-j','ACCEPT');
 // No DNS needed after pinning this process's validated provider addresses.
 for(const ip of addresses)ipt('-A','OUTPUT','-d',ip,'-p','tcp','--dport','443','-j','ACCEPT');
 execFileSync('ip6tables',['-P','OUTPUT','DROP'],{stdio:'ignore'});
 process.setgroups([]);process.setgid(1000);process.setuid(1000);
 let upstreamRequests=0;
 const app=http.createServer((q,r)=>{
  r.setHeader('cache-control','no-store');r.setHeader('content-type','application/json');
  if(q.method!=='GET'||q.url!=='/probe'||q.headers.authorization||q.headers['x-api-key']){r.writeHead(403);return r.end('{"error":"preparation_egress_denied"}');}
  if(upstreamRequests>=5){r.writeHead(429);return r.end('{"error":"preparation_probe_limit"}');}
  upstreamRequests++;
  const p=https.request({hostname:'api.paystack.co',servername:'api.paystack.co',port:443,path:'/',method:'GET',rejectUnauthorized:true,agent:false,lookup:(_host,_opts,cb)=>cb(null,[{address:addresses[0],family:4}]),timeout:8000,headers:{accept:'application/json'}},x=>{
   // Never forward response bodies, redirect locations or cookies.
   x.resume();r.writeHead(200);r.end(JSON.stringify({destination:'api.paystack.co:443',tls_verified:true,upstream_status:x.statusCode,financial_requests:0}));
  });p.on('timeout',()=>p.destroy());p.on('error',()=>{if(!r.headersSent){r.writeHead(502);r.end('{"error":"provider_probe_failed"}');}});p.end();
 });
 app.on('connect',(q,s)=>s.end('HTTP/1.1 403 Forbidden\r\n\r\n'));
 app.listen(8080,'0.0.0.0',()=>console.log(JSON.stringify({mode:'preparation-only',provider:'api.paystack.co',uid:process.getuid(),firewall:'default-deny',financial_requests:0})));
}
main().catch(()=>{console.error('provider_egress_startup_denied');process.exit(1)});
