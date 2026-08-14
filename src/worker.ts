import dotenv from "dotenv";
dotenv.config();

import { startAutomationWorker } from "./workers/automationWorker";
import { startIntentWorker } from "./workers/intentWorker";
import { startIntentDlqWorker } from "./workers/intentDlqWorker";
import { startProactiveIntelligenceScheduler } from "./oyi-core/runtime/proactiveIntelligenceScheduler";

startAutomationWorker();
startIntentWorker();
startIntentDlqWorker();
startProactiveIntelligenceScheduler();

console.log("🧠 Workers running");
