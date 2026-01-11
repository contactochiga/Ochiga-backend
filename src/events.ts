import dotenv from "dotenv";
dotenv.config();

import { startEventProcessor } from "./event-processor/eventProcessor";
import { initMqttBridge } from "./device/bridge";

await initMqttBridge();
startEventProcessor();

console.log("📡 Event processor running");
