import dotenv from "dotenv";
dotenv.config();

import { startAutomationWorker } from "./workers/automationWorker";
import { startIntentWorker } from "./workers/intentWorker";
import { startIntentDlqWorker } from "./workers/intentDlqWorker";
import { startProactiveIntelligenceScheduler } from "./oyi-core/runtime/proactiveIntelligenceScheduler";
import { startCameraMediaRetentionWorker } from "./workers/cameraMediaRetentionWorker";

startAutomationWorker();
startIntentWorker();
startIntentDlqWorker();
startProactiveIntelligenceScheduler();
startCameraMediaRetentionWorker();

console.log("🧠 Workers running");
