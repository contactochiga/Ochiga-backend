import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalRoot = path.join(root, "packages/oyi-camera-core/src");
const targetRoots = [
  path.join(root, "../facility-oyi/lib/oyi-camera-core"),
  path.join(root, "../Oyi-os-frontend/src/lib/oyi-camera-core"),
];

for (const targetRoot of targetRoots) {
  for (const file of ["media.ts", "detection.ts"]) {
    assert.equal(fs.readFileSync(path.join(targetRoot, file), "utf8"), fs.readFileSync(path.join(canonicalRoot, file), "utf8"), `Camera Core drift: ${path.join(targetRoot, file)}`);
  }
  assert.equal(fs.readFileSync(path.join(targetRoot, "runtime.ts"), "utf8"), fs.readFileSync(path.join(canonicalRoot, "core.ts"), "utf8"), `Camera Core runtime drift: ${path.join(targetRoot, "runtime.ts")}`);
  const expectedReact = fs.readFileSync(path.join(canonicalRoot, "react.ts"), "utf8").replace('from "./core"', 'from "./runtime"');
  assert.equal(fs.readFileSync(path.join(targetRoot, "useCameraPlayback.ts"), "utf8"), expectedReact, `Camera Core React drift: ${path.join(targetRoot, "useCameraPlayback.ts")}`);
  assert.match(fs.readFileSync(path.join(targetRoot, "core.ts"), "utf8"), /DO NOT EDIT DIRECTLY/);
  const manifest = JSON.parse(fs.readFileSync(path.join(targetRoot, "manifest.json"), "utf8"));
  for (const [file, expected] of Object.entries(manifest.hashes)) {
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(targetRoot, file))).digest("hex");
    assert.equal(actual, expected, `Camera Core generated artifact changed without sync: ${path.join(targetRoot, file)}`);
  }
}

console.log("Canonical Camera Core distribution verified");
