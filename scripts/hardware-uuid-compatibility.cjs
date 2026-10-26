'use strict';
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const awsRequire=createRequire(require.resolve('aws-sdk'));
const uuid=awsRequire('uuid');
const AWS=require('aws-sdk');
const values=new Set();
for(let i=0;i<1000;i++){const id=AWS.util.uuid.v4();assert(uuid.validate(id));assert.equal(uuid.version(id),4);values.add(id);}
assert.equal(values.size,1000);
// Build and sign a request using synthetic credentials only; never send it.
const s3=new AWS.S3({region:'eu-west-1',accessKeyId:'SYNTHETIC',secretAccessKey:'SYNTHETIC',maxRetries:0});
const request=s3.putObject({Bucket:'isolated-test',Key:'fixture',Body:Buffer.from('synthetic'),ContentType:'text/plain'});
request.build(error=>{if(error)throw error;assert.equal(request.httpRequest.method,'PUT');assert(request.httpRequest.headers.Authorization);console.log('1000 AWS UUID v4 generation/validation checks plus offline signed S3 request PASS (zero network requests)');});
