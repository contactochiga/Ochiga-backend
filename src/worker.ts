import dotenv from "dotenv";
dotenv.config();

import { startAutomationWorker } from "./workers/automationWorker";
import { startIntentWorker } from "./workers/intentWorker";
import { startIntentDlqWorker } from "./workers/intentDlqWorker";
import { startProactiveIntelligenceScheduler } from "./oyi-core/runtime/proactiveIntelligenceScheduler";
import { startCameraMediaRetentionWorker } from "./workers/cameraMediaRetentionWorker";
import { startCameraHealthTransitionWorker } from "./workers/cameraHealthTransitionWorker";
import { startCanonicalMaterializationWorker } from "./workers/canonicalMaterializationWorker";
import { startConversationTraceRetentionWorker } from "./workers/conversationTraceRetentionWorker";

startAutomationWorker();
startIntentWorker();
startIntentDlqWorker();
startProactiveIntelligenceScheduler();
startCameraMediaRetentionWorker();
startCameraHealthTransitionWorker();
startCanonicalMaterializationWorker();
startConversationTraceRetentionWorker();

console.log("🧠 Workers running");
