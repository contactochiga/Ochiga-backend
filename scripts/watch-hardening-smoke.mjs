import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import {
  canControlWatch,
  canReadWatch,
  deviceWithinActorScope,
  hasWatchScope,
} from "../dist/services/watchPolicy.js";
process.env.SUPABASE_URL ||= "https://watch-hardening-smoke.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "watch-hardening-smoke-key";
const {
  isDeviceDefinitelyOffline,
  normalizeDeviceOnlineState,
} = await import("../dist/services/deviceRuntimeService.js");

const resident = {
  id: "resident-1",
  role: "resident",
  estate_id: "estate-1",
  home_id: "home-1",
};

assert.equal(hasWatchScope({ ...resident, estate_id: null, home_id: null }), false);
assert.equal(canReadWatch(resident), true);
assert.equal(canControlWatch(resident), true);
assert.equal(deviceWithinActorScope(resident, { estate_id: "estate-1", home_id: "home-2" }), false);
assert.equal(deviceWithinActorScope(resident, { estate_id: "estate-1", home_id: "home-1" }), true);
assert.equal(canReadWatch({ ...resident, role: "guest" }), false);
assert.equal(canControlWatch({ ...resident, role: "guest" }), false);
assert.equal(normalizeDeviceOnlineState({ status: "offline" }).state, "offline");
assert.equal(isDeviceDefinitelyOffline({ status: "offline" }), false);
assert.equal(isDeviceDefinitelyOffline({ online: false }), true);
assert.equal(isDeviceDefinitelyOffline({ online: true, status: "offline" }), false);

const secret = "watch-hardening-smoke-secret";
const expired = jwt.sign({ sub: "resident-1" }, secret, { expiresIn: -1 });
assert.throws(() => jwt.verify(expired, secret), /expired/i);

console.log("watch hardening smoke checks passed");
