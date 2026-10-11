// For an explicitly configured test/deployment environment. Does not migrate.
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {preflightConversationTrace}=require('../dist/oyi-core/observability/conversationTraceSchema.js');
const {traceReferenceKeyConfigured}=require('../dist/oyi-core/observability/conversationTraceProjection.js');
if(!traceReferenceKeyConfigured()||process.env.OYI_CONVERSATION_TRACE_ENABLED==='false'){
 console.log(JSON.stringify({status:'configuration_required',reason:'durable_trace_not_active'}));process.exitCode=1;
}else{const result=await preflightConversationTrace();console.log(JSON.stringify(result));process.exitCode=result.status==='compatible'?0:1;}
