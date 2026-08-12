import "dotenv/config";
import assert from "node:assert/strict";
import { requireOfficeCommunicationKey } from "../dist/routes/communications.js";

const EXPECTED_KEY = "smoke-test-communications-office-key-4b8e1d";

function mockReq(headers = {}) {
  return { headers };
}

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

function run(headers) {
  const req = mockReq(headers);
  const res = mockRes();
  let nextCalled = false;
  requireOfficeCommunicationKey(req, res, () => {
    nextCalled = true;
  });
  return { nextCalled, statusCode: res.statusCode, body: res.body };
}

process.env.OFFICE_SYNC_API_KEY = EXPECTED_KEY;
delete process.env.OFFICE_EXPORT_API_KEY;

// Legacy path: x-api-key header — must be unchanged.
{
  const result = run({ "x-api-key": EXPECTED_KEY });
  assert.equal(result.nextCalled, true, "x-api-key with the correct key must authorize");
  assert.equal(result.statusCode, null);
}

// New path: x-office-api-key — the header the Office gateway actually
// sends (ochiga-office/src/lead-agents/oyi-core-gateway.js), now
// recognized on the communications office-public surface too.
{
  const result = run({ "x-office-api-key": EXPECTED_KEY });
  assert.equal(result.nextCalled, true, "x-office-api-key with the correct key must authorize");
  assert.equal(result.statusCode, null);
}

// Existing path: Authorization Bearer — must be unchanged.
{
  const result = run({ authorization: `Bearer ${EXPECTED_KEY}` });
  assert.equal(result.nextCalled, true, "Bearer token with the correct key must authorize");
  assert.equal(result.statusCode, null);
}

// Precedence unchanged: x-api-key still wins when both headers are present.
{
  const result = run({ "x-api-key": EXPECTED_KEY, "x-office-api-key": "wrong-value" });
  assert.equal(result.nextCalled, true, "x-api-key must still be checked first and authorize correctly");
}

// Wrong credential on each path -> 401, next never called.
{
  const result = run({ "x-api-key": "not-the-right-key" });
  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 401);
  assert.equal(result.body?.error, "Invalid office communications key");
}
{
  const result = run({ "x-office-api-key": "not-the-right-key" });
  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 401);
}
{
  const result = run({ authorization: "Bearer not-the-right-key" });
  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 401);
}

// No credential at all -> 401.
{
  const result = run({});
  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 401);
}

// No server-side key configured at all -> fail closed with 503,
// regardless of what the caller sends.
{
  delete process.env.OFFICE_SYNC_API_KEY;
  delete process.env.OFFICE_EXPORT_API_KEY;
  const result = run({ "x-office-api-key": EXPECTED_KEY });
  assert.equal(result.nextCalled, false, "an unconfigured server key must never authorize a request");
  assert.equal(result.statusCode, 503);
  assert.equal(result.body?.error, "OFFICE_SYNC_API_KEY is not configured");
  process.env.OFFICE_SYNC_API_KEY = EXPECTED_KEY;
}

console.log("communications-office-auth-compat-smoke: PASS");
