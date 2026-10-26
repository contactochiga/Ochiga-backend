'use strict';
const http=require('http'),https=require('https'),fs=require('fs'),dns=require('dns').promises,{execFileSync}=require('child_process');
const {bridge,wireHash}=require('./integration.cjs');
function safeFailure(error){
 const code=typeof error?.code==='string'?error.code:'provider_transport_unknown';
 const allowed=new Set(['provider_http_4xx','provider_rate_limited','provider_http_5xx','pre_dispatch_connection_failure','post_dispatch_timeout_or_lost_response','malformed_provider_response','provider_transport_unknown']);
 return allowed.has(code)?code:'provider_transport_unknown';
}
function classifyProviderStatus(status){
 if(status===429)return 'provider_rate_limited';
 if(status>=400&&status<500)return 'provider_http_4xx';
 if(status>=500&&status<600)return 'provider_http_5xx';
 return null;
}
function handler({config,key,send,consume=bridge}){return async(q,r)=>{
 r.setHeader('cache-control','no-store');
 if(!config||!key){r.writeHead(503);return r.end();}
 if(q.method!=='POST'||q.url!=='/financial'||q.headers.authorization){r.writeHead(403);return r.end();}
 try{
  let n=0,chunks=[];for await(const b of q){n+=b.length;if(n>32768)throw Error();chunks.push(b);}
  const p=JSON.parse(Buffer.concat(chunks));
  if(Object.keys(p).sort().join(',')!=='body,method,reference,ticket,url'||!['GET','POST'].includes(p.method)||typeof p.ticket!=='string')throw Error();
  const singleOnly=config.manifest?.execution_profile==='single-initialization-only';
  const exact=singleOnly
   ? p.method==='POST'&&p.url==='/transaction/initialize'
   : (p.method==='POST'&&['/transaction/initialize','/refund'].includes(p.url))||(p.method==='GET'&&(/^\/transaction\/verify\/hwo_[a-f0-9]{32}$/.test(p.url)||/^\/refund\/[1-9][0-9]{0,39}$/.test(p.url)||/^\/refund\?transaction=[1-9][0-9]{0,39}&perPage=100&page=([1-9]|10)$/.test(p.url)||/^\/dispute\/transaction\/[1-9][0-9]{0,39}$/.test(p.url)));
  if(!exact)throw Error('route_denied');
  // Consume once, durably, before the only possible external side effect.
  consume(config,'consume',{reference:p.reference,ticket:p.ticket,request_hash:wireHash(p.method,p.url,p.body)});
  const data=await send(p,key);r.setHeader('content-type','application/json');r.writeHead(200);r.end(JSON.stringify(data));
 }catch(e){const code=safeFailure(e);const status=code==='provider_http_4xx'?502:code==='provider_rate_limited'?503:code==='provider_http_5xx'?502:503;r.setHeader('content-type','application/json');r.writeHead(status);r.end(JSON.stringify({error:code}));}
};}
async function main(){
 for(const name of ['PAYSTACK_SECRET_KEY','PAYSTACK_SECRECT_KEY','DATABASE_URL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','RESEND_API_KEY','SMTP_HOST'])if(process.env[name])throw Error('unrelated_credentials_denied');
 let config=null,key=null,addresses=[];
 if(process.env.PROVIDER_FINANCIAL_RELAY_ENABLED==='true'){
  config=JSON.parse(fs.readFileSync('/run/execution/config.json','utf8'));
  if(config.mode!=='real-provider'||config.database!=='/run/execution/run.sqlite'||config.manifest?.execution_profile!=='single-initialization-only')throw Error();
  bridge(config,process.env.PROVIDER_FINANCIAL_EXECUTION_ENABLED==='true'?'plan':'preflight-plan');
  key=require('../../dist/commerce/hardwareSetupServer').setupWebhookSigningKey({HARDWARE_TEST_WEBHOOK_KEY_FILE:'/run/secrets/hardware-test-key'});
  addresses=(await dns.resolve4('api.paystack.co')).filter(ip=>! /^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|198\.(18|19)\.|22[4-9]\.|2[3-5]\d\.)/.test(ip));
  if(!addresses.length)throw Error();
 }
 const ipt=(...args)=>execFileSync('iptables',args,{stdio:'ignore'});ipt('-P','OUTPUT','DROP');ipt('-A','OUTPUT','-m','conntrack','--ctstate','ESTABLISHED,RELATED','-j','ACCEPT');
 for(const ip of addresses)ipt('-A','OUTPUT','-d',ip,'-p','tcp','--dport','443','-j','ACCEPT');execFileSync('ip6tables',['-P','OUTPUT','DROP'],{stdio:'ignore'});
 const owner=config?fs.statSync(config.database):{uid:1000,gid:1000};if(owner.uid===0)throw Error('unprivileged_ledger_owner_required');process.setgroups([]);process.setgid(owner.gid);process.setuid(owner.uid);
 const send=(p,secret)=>new Promise((resolve,reject)=>{
  let dispatched=false,settled=false;
  const fail=(code)=>{if(settled)return;settled=true;const e=Error(code);e.code=code;reject(e);};
  const body=p.body===null?undefined:JSON.stringify(p.body);
  const req=https.request({hostname:'api.paystack.co',servername:'api.paystack.co',port:443,path:p.url,method:p.method,rejectUnauthorized:true,agent:false,lookup:(_h,_o,cb)=>cb(null,[{address:addresses[0],family:4}]),timeout:15000,headers:{authorization:'Bearer '+secret,accept:'application/json',...(body?{'content-type':'application/json','content-length':Buffer.byteLength(body)}:{})}},res=>{
   let size=0,chunks=[];res.on('data',b=>{size+=b.length;if(size>2097152){res.destroy();fail('malformed_provider_response');}else chunks.push(b)});res.on('end',()=>{const providerClass=classifyProviderStatus(res.statusCode);if(providerClass)return fail(providerClass);try{const parsed=JSON.parse(Buffer.concat(chunks));if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)){return fail('malformed_provider_response');}settled=true;resolve(parsed);}catch{fail('malformed_provider_response');}});res.on('error',()=>fail(dispatched?'post_dispatch_timeout_or_lost_response':'pre_dispatch_connection_failure'));
  });req.on('socket',socket=>{socket.once('secureConnect',()=>{dispatched=true;});});req.on('timeout',()=>{req.destroy();fail(dispatched?'post_dispatch_timeout_or_lost_response':'pre_dispatch_connection_failure');});req.on('error',()=>fail(dispatched?'post_dispatch_timeout_or_lost_response':'pre_dispatch_connection_failure'));req.end(body);
 });
 const server=http.createServer(handler({config,key,send}));server.on('connect',(_q,s)=>s.end('HTTP/1.1 403 Forbidden\r\n\r\n'));server.listen(8080,'0.0.0.0');
}
if(require.main===module)main().catch(()=>{console.error('bounded_relay_startup_denied');process.exitCode=1;});
module.exports={handler,safeFailure,classifyProviderStatus};
