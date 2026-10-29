'use strict';
const assert=require('node:assert/strict');
const {assertEnvironment,singleInitializationPathAllowed}=require('./execution-server.cjs');
const base={
 HARDWARE_SETUP_ONLY:'true',SUPABASE_URL:'http://backend-rest:3000',
 HARDWARE_TEST_CALLBACK_ORIGIN:'https://localhost:18443',
 HARDWARE_PAYSTACK_CALLBACK_URL:'https://localhost:18443/hardware/checkout',
 OFFICE_HARDWARE_PAYMENT_CONFIRM_URL:'https://office.hardware.test/api/commerce/payments/confirm',
 OFFICE_HARDWARE_FINANCIAL_URL:'https://office.hardware.test/api/commerce/payments/operations',
 HARDWARE_EXECUTION_PROFILE:'single-initialization-only',HARDWARE_PAYMENT_INITIALIZATION_ENABLED:'true',
 HARDWARE_PAYMENT_PROCESSING_ENABLED:'false',HARDWARE_FINANCIAL_RECOVERY_ENABLED:'false',HARDWARE_REFUNDS_ENABLED:'false',
 OFFICE_HARDWARE_PAYMENT_CONFIRM_KEY:'a'.repeat(40),OFFICE_HARDWARE_FINANCIAL_KEY:'b'.repeat(40),HARDWARE_OFFICE_API_KEY:'c'.repeat(40),
};
assert.doesNotThrow(()=>assertEnvironment(base));
for(const key of ['HARDWARE_PAYMENT_PROCESSING_ENABLED','HARDWARE_FINANCIAL_RECOVERY_ENABLED','HARDWARE_REFUNDS_ENABLED'])assert.throws(()=>assertEnvironment({...base,[key]:'true'}));
assert.throws(()=>assertEnvironment({...base,HARDWARE_PAYMENT_INITIALIZATION_ENABLED:'false'}));
assert.equal(singleInitializationPathAllowed('POST','/initialize'),true);
for(const x of [['POST','/reconcile'],['GET','/initialize'],['POST','/refund'],['POST','/recover'],['POST','/replay'],['POST','/initialize?x=1']])assert.equal(singleInitializationPathAllowed(...x),false);
console.log('single-init runtime flags and HTTP surface: 13 assertions PASS; no provider requests');
