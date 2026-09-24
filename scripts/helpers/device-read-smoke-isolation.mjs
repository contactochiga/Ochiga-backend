import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Watch imports the scheduler through its read graph. Its module-level BullMQ
// construction opens Redis sockets even when scheduling is disabled. A read smoke
// must never connect to the deployment's queue. Stub at the test dependency boundary
// BEFORE importing application code; do not force process.exit or change runtime.
process.env.SUPABASE_URL = "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "device-read-smoke-fixture-only";
const scheduler = require.resolve("../../dist/oyi-core/runtime/proactiveIntelligenceScheduler.js");
require.cache[scheduler] = { id: scheduler, filename: scheduler, loaded: true, exports: {
  proactiveIntelligenceQueue: { add: async () => { throw new Error("Read smoke attempted queue submission"); } },
  startProactiveIntelligenceScheduler: async () => { throw new Error("Read smoke attempted scheduler startup"); },
  runProactiveIntelligenceTick: async () => { throw new Error("Read smoke attempted proactive execution"); },
} };
for (const name of ["intentWorker", "intentDlqWorker"]) {
  const filename = require.resolve(`../../dist/workers/${name}.js`);
  const forbidden = async () => { throw new Error("Read smoke attempted physical intent execution"); };
  require.cache[filename] = { id: filename, filename, loaded: true, exports: {
    intentQueue: { add: forbidden }, intentDlqQueue: { add: forbidden },
    enqueueIntent: forbidden, handleDeviceIntent: forbidden,
    startIntentWorker: forbidden, startIntentDlqWorker: forbidden,
  } };
}

// Honor scalar projections and joined aliases, rather than returning whole fixture
// records for SELECT id. This detects missing policy inputs in actual query chains.
export function projectSelected(row, selection = "*") {
  if (!row || selection.trim() === "*") return row;
  const fields = selection.split(/,(?![^()]*\))/).map(s => s.trim()).filter(Boolean);
  return Object.fromEntries(fields.map(field => {
    const key = field.split(/[:(]/)[0].trim();
    return [key, row[key]];
  }));
}
