'use strict';
// Fixed internal relay only. No arbitrary URLs, provider credential or redirects.
function relayClient(){return {boundary:'isolated-paystack-relay-v1',dispatch:async payload=>{
 const r=await fetch('http://hardware-provider-egress:8080/financial',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!r.ok){let code='provider_transport_unknown';try{const body=await r.json();if(typeof body?.error==='string'&&/^provider_(http_4xx|rate_limited|http_5xx|transport_unknown)|^(pre_dispatch_connection_failure|post_dispatch_timeout_or_lost_response|malformed_provider_response)$/.test(body.error))code=body.error;}catch{}const e=Error(code);e.code=code;throw e;}return {data:await r.json()};
}};}
module.exports={relayClient};
