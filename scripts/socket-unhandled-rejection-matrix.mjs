// Driver: runs socket-unhandled-rejection-repro.mjs once per named socket
// lifecycle boundary, each in its own child process (module-level
// singletons in server.ts require process isolation per case), and
// records whether the process crashed with ERR_UNHANDLED_REJECTION.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPRO_SCRIPT = path.join(__dirname, "socket-unhandled-rejection-repro.mjs");

const CASES = [
  "auth_db",
  "auth_fail_audit",
  "subscribe_estate_deny",
  "subscribe_user_deny",
  "subscribe_room",
  "subscribe_home",
  "subscribe_device",
  "subscribe_thread",
  "scope_replace_home",
  "disconnect",
];

const mode = process.argv[2] === "--guarded" ? "guarded" : "baseline";
let basePort = 58400;

function runCase(name, port) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [REPRO_SCRIPT], {
      env: { ...process.env, REPRO_CASE: name, REPRO_PORT: String(port), REPRO_MODE: mode },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    const killer = setTimeout(() => child.kill("SIGKILL"), 9000);
    child.on("exit", (code, signal) => {
      clearTimeout(killer);
      const crashed = /ERR_UNHANDLED_REJECTION/.test(stderr) || /ERR_UNHANDLED_REJECTION/.test(stdout);
      const connected = /HARNESS_SOCKET_CONNECTED/.test(stdout);
      const denied = /HARNESS_PERMISSION_DENIED/.test(stdout);
      const survivedCleanly = /HARNESS_RESULT/.test(stdout);
      resolve({ case: name, code, signal, crashed, connected, denied, survivedCleanly, stdout, stderr });
    });
  });
}

const results = [];
for (const name of CASES) {
  basePort += 1;
  const result = await runCase(name, basePort);
  results.push(result);
  console.log(`[${mode}] ${name}: ${result.crashed ? "CRASHED (ERR_UNHANDLED_REJECTION)" : result.survivedCleanly ? "survived" : `exited(code=${result.code},signal=${result.signal}) without clean HARNESS_RESULT`}`);
}

console.log("\n=== SUMMARY (" + mode + ") ===");
console.log("| case | outcome |");
console.log("| --- | --- |");
for (const r of results) {
  console.log(`| ${r.case} | ${r.crashed ? "CRASHED" : r.survivedCleanly ? "survived" : "inconclusive"} |`);
}

const anyCrashed = results.some((r) => r.crashed);
process.exit(mode === "baseline" ? (anyCrashed ? 0 : 1) : (anyCrashed ? 1 : 0));
