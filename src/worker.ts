import dotenv from "dotenv";
dotenv.config();

import { startAutomationWorker } from "./workers/automationWorker";
import { startIntentWorker } from "./workers/intentWorker";
import { startIntentDlqWorker } from "./workers/intentDlqWorker";
import { startProactiveIntelligenceScheduler } from "./oyi-core/runtime/proactiveIntelligenceScheduler";
import { startCameraMediaRetentionWorker } from "./workers/cameraMediaRetentionWorker";
import { startCameraHealthTransitionWorker } from "./workers/cameraHealthTransitionWorker";

startAutomationWorker();
startIntentWorker();
startIntentDlqWorker();
startProactiveIntelligenceScheduler();
startCameraMediaRetentionWorker();
startCameraHealthTransitionWorker();

console.log("🧠 Workers running");
