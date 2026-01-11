import dotenv from "dotenv";
dotenv.config();

import { startEventProcessor } from "./event-processor/eventProcessor";
import { initMqttBridge } from "./device/bridge";

async function main() {
  await initMqttBridge();
  startEventProcessor();
  console.log("📡 Event processor running");
}

main().catch((err) => {
  console.error("🔴 Event processor failed to start:", err);
  process.exit(1);
});
