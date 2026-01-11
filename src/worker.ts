import dotenv from "dotenv";
dotenv.config();

import { startAutomationWorker } from "./workers/automationWorker";
import { startIntentWorker } from "./workers/intentWorker";
import { startIntentDlqWorker } from "./workers/intentDlqWorker";

startAutomationWorker();
startIntentWorker();
startIntentDlqWorker();

console.log("🧠 Workers running");
