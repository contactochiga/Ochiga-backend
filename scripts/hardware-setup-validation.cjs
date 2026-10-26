const assert=require('node:assert/strict');
const {assertSetupEnvironment}=require('../dist/commerce/hardwareSetupServer');
const {paymentCallback}=require('../dist/commerce/hardwarePayments');
const good={HARDWARE_SETUP_ONLY:'true',HARDWARE_TEST_CALLBACK_ORIGIN:'https://localhost:18443',HARDWARE_PAYSTACK_CALLBACK_URL:'https://localhost:18443/hardware/checkout',HARDWARE_PAYSTACK_SECRET_KEY:'sk_test_SETUP_synthetic',SUPABASE_URL:'http://backend-rest:3000',SUPABASE_SERVICE_ROLE_KEY:'synthetic',HARDWARE_OFFICE_API_KEY:'synthetic'};
for(const k of ['HARDWARE_PAYMENT_INITIALIZATION_ENABLED','HARDWARE_PAYMENT_PROCESSING_ENABLED','HARDWARE_FINANCIAL_RECOVERY_ENABLED','HARDWARE_REFUNDS_ENABLED'])good[k]='false';
assert.doesNotThrow(()=>assertSetupEnvironment(good));let count=1;
for(const k of Object.keys(good)){const e={...good};delete e[k];assert.throws(()=>assertSetupEnvironment(e));count++;}
for(const k of ['PAYSTACK_SECRET_KEY','PAYSTACK_SECRECT_KEY','DATABASE_URL','RESEND_API_KEY']){assert.throws(()=>assertSetupEnvironment({...good,[k]:'forbidden'}));count++;}
for(const u of ['https://getoyi.com/hardware/checkout','https://localhost:18443/hardware/checkout?x=1','https://evil.invalid/hardware/checkout','http://localhost:18443/hardware/checkout','https://localhost:18444/hardware/checkout']){assert.throws(()=>paymentCallback(u,good.HARDWARE_TEST_CALLBACK_ORIGIN));count++;}
console.log(count+' setup startup/callback denial checks PASS');
