import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalRoot = path.join(root, "packages/oyi-camera-core/src");
const targetRoots = [
  path.join(root, "../facility-oyi/lib/oyi-camera-core"),
  path.join(root, "../Oyi-os-frontend/src/lib/oyi-camera-core"),
];

for (const targetRoot of targetRoots) {
  fs.mkdirSync(targetRoot, { recursive: true });
  for (const file of ["media.ts", "detection.ts"]) {
    fs.copyFileSync(path.join(canonicalRoot, file), path.join(targetRoot, file));
  }
  fs.copyFileSync(path.join(canonicalRoot, "core.ts"), path.join(targetRoot, "runtime.ts"));
  fs.writeFileSync(
    path.join(targetRoot, "core.ts"),
    "// DO NOT EDIT DIRECTLY — generated from canonical Oyi Camera Core.\nexport * from \"./runtime\";\n",
  );
  const reactSource = fs.readFileSync(path.join(canonicalRoot, "react.ts"), "utf8")
    .replace('from "./core"', 'from "./runtime"');
  fs.writeFileSync(path.join(targetRoot, "useCameraPlayback.ts"), reactSource);
  const distributed = ["core.ts", "runtime.ts", "media.ts", "detection.ts", "useCameraPlayback.ts"];
  const hashes = Object.fromEntries(distributed.map((file) => [file, crypto.createHash("sha256").update(fs.readFileSync(path.join(targetRoot, file))).digest("hex")]));
  fs.writeFileSync(path.join(targetRoot, "manifest.json"), `${JSON.stringify({ source: "Ochiga-backend/packages/oyi-camera-core/src", version: "5.0.0-phase5", hashes }, null, 2)}\n`);
}

console.log(`Synced canonical Camera Core to ${targetRoots.length} surfaces`);
