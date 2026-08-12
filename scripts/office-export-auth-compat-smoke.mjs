import "dotenv/config";
import assert from "node:assert/strict";
import { requireOfficeExportKey } from "../dist/routes/officeExport.js";

const EXPECTED_KEY = "smoke-test-office-key-9f2c7a";

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
  requireOfficeExportKey(req, res, () => {
    nextCalled = true;
  });
  return { nextCalled, statusCode: res.statusCode, body: res.body };
}

process.env.OFFICE_SYNC_API_KEY = EXPECTED_KEY;
delete process.env.OFFICE_EXPORT_API_KEY;

// Legacy path: x-api-key header (unchanged, must still work).
{
  const result = run({ "x-api-key": EXPECTED_KEY });
  assert.equal(result.nextCalled, true, "x-api-key with the correct key must be authorized");
  assert.equal(result.statusCode, null, "authorized request must not set an error status");
}

// New path: x-office-api-key header — the actual header the Office
// gateway sends (ochiga-office/src/lead-agents/oyi-core-gateway.js).
{
  const result = run({ "x-office-api-key": EXPECTED_KEY });
  assert.equal(result.nextCalled, true, "x-office-api-key with the correct key must be authorized");
  assert.equal(result.statusCode, null, "authorized request must not set an error status");
}

// Existing path: Authorization Bearer (unchanged, must still work).
{
  const result = run({ authorization: `Bearer ${EXPECTED_KEY}` });
  assert.equal(result.nextCalled, true, "Bearer token with the correct key must be authorized");
  assert.equal(result.statusCode, null, "authorized request must not set an error status");
}

// x-api-key still takes priority over x-office-api-key when both are present
// (order of precedence is unchanged for the pre-existing header).
{
  const result = run({ "x-api-key": EXPECTED_KEY, "x-office-api-key": "wrong-value" });
  assert.equal(result.nextCalled, true, "x-api-key must still be checked first and authorize correctly");
}

// No credential at all -> 401, next must not be called.
{
  const result = run({});
  assert.equal(result.nextCalled, false, "a request with no credential must not call next()");
  assert.equal(result.statusCode, 401, "a request with no credential must be rejected with 401");
  assert.equal(result.body?.error, "Invalid office sync key");
}

// Wrong credential on the new header -> 401, next must not be called.
{
  const result = run({ "x-office-api-key": "not-the-right-key" });
  assert.equal(result.nextCalled, false, "a wrong x-office-api-key must not call next()");
  assert.equal(result.statusCode, 401, "a wrong x-office-api-key must be rejected with 401");
}

// Wrong credential on the legacy header -> 401 (regression: must still fail correctly).
{
  const result = run({ "x-api-key": "not-the-right-key" });
  assert.equal(result.nextCalled, false, "a wrong x-api-key must not call next()");
  assert.equal(result.statusCode, 401);
}

// Wrong Bearer token -> 401 (regression: must still fail correctly).
{
  const result = run({ authorization: "Bearer not-the-right-key" });
  assert.equal(result.nextCalled, false, "a wrong Bearer token must not call next()");
  assert.equal(result.statusCode, 401);
}

// No expected key configured on the server at all -> fail closed with 503,
// regardless of what the caller sends. Must never fall back to allowing access.
{
  delete process.env.OFFICE_SYNC_API_KEY;
  delete process.env.OFFICE_EXPORT_API_KEY;
  const result = run({ "x-office-api-key": EXPECTED_KEY });
  assert.equal(result.nextCalled, false, "an unconfigured server key must never authorize a request");
  assert.equal(result.statusCode, 503);
  assert.equal(result.body?.error, "OFFICE_SYNC_API_KEY is not configured");
  process.env.OFFICE_SYNC_API_KEY = EXPECTED_KEY;
}

console.log("office-export-auth-compat-smoke: PASS");
