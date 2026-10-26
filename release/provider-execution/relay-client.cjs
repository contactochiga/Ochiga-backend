'use strict';
// Fixed internal relay only. No arbitrary URLs, provider credential or redirects.
function relayClient(){return {boundary:'isolated-paystack-relay-v1',dispatch:async payload=>{
 const r=await fetch('http://hardware-provider-egress:8080/financial',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('isolated_relay_unavailable');return {data:await r.json()};
}};}
module.exports={relayClient};
