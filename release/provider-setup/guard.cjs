const e=process.env,mode=e.ISOLATED_SERVICE;
function deny(){console.error('isolated_service_startup_denied');process.exit(1);}
for(const k of ['PAYSTACK_SECRET_KEY','PAYSTACK_SECRECT_KEY','DATABASE_URL','RESEND_API_KEY','SMTP_HOST','TWILIO_AUTH_TOKEN'])if(e[k])deny();
if(mode==='office'){
 if(e.OPENAI_API_KEY!=='sk-SETUP-NOT-A-CREDENTIAL'||e.OPENAI_BASE_URL!=='http://127.0.0.1:9/v1')deny();
 if(e.SUPABASE_URL!=='http://office-data:3000'||!e.SUPABASE_SERVICE_ROLE_KEY||e.OFFICE_APP_URL!=='https://localhost:18445'||!e.LEAD_AGENTS_SCOPED_API_KEYS||e.OFFICE_HARDWARE_PAYMENTS_ENABLED!=='false'||e.OFFICE_HARDWARE_PAYMENT_PROCESSING_ENABLED!=='false')deny();
}else if(mode==='getoyi'){
 if(e.OCHIGA_OFFICE_CHECKOUT_URL!=='https://office.hardware.test'||!e.OCHIGA_OFFICE_CHECKOUT_KEY||!e.HARDWARE_CHECKOUT_SESSION_SECRET||e.GETOYI_CHECKOUT_ORIGIN!=='https://localhost:18443'||['HARDWARE_PAYMENTS_ENABLED','HARDWARE_CATALOGUE_ENABLED','HARDWARE_CHECKOUT_ENABLED'].some(k=>e[k]!=='false'))deny();
}else deny();
