import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const oyiRoutes = await readFile(new URL("../src/routes/oyiRoutes.ts", import.meta.url), "utf8");
const aiRoutes = await readFile(new URL("../src/routes/aiRoutes.ts", import.meta.url), "utf8");

assert.match(oyiRoutes, /runCanonicalConversation/);
assert.match(aiRoutes, /runCanonicalConversation/);
assert.doesNotMatch(oyiRoutes, /runOyiUnifiedChat\(/);
assert.doesNotMatch(aiRoutes, /routeAiCommand\(req,\s*\{/);

console.log("compatibility delegation smoke ok");
