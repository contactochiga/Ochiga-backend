// src/config/publicUrls.ts
//
// Production incident: the resident/Home-invite email link and QR code
// both pointed at "https://oyi.com" -- a third-party domain-parking page,
// not ours. The bug: makeResidentInviteUrl() (homeUsers.controller.ts)
// chained through CONSUMER_APP_BASE (defined nowhere in this repo) and
// VISITOR_LINK_BASE (a real env var, but scoped to visitor-pass deep
// links -- src/controllers/visitorController.ts's own, unrelated,
// "${base}/${visitorId}" contract) before falling back to the hardcoded
// dead literal. Three more call sites (residents.ts, estates.ts,
// facility.controller.ts) independently built the identical
// "/auth/invite?token=" URL off the same wrong chain -- exactly the
// "no single canonical builder" failure this module closes.
//
// CONSUMER_APP_URL and FACILITY_APP_URL are already the established,
// correctly-scoped names for these origins elsewhere in this codebase
// (src/config/originPolicy.ts's own CORS allowlist already reads both),
// reused here rather than inventing new names. Fallbacks are the real,
// empirically-verified live production domains (HTTP 200, serving the
// actual Oyi OS / Oyi Facility apps) -- not guessed.

function resolvedOrigin(envValue: string | undefined, productionFallback: string): string {
  const explicit = String(envValue || "").trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  return process.env.NODE_ENV === "production" ? productionFallback : "";
}

export const CONSUMER_APP_URL = resolvedOrigin(process.env.CONSUMER_APP_URL, "https://app.getoyi.com");
export const FACILITY_APP_URL = resolvedOrigin(process.env.FACILITY_APP_URL, "https://facility.getoyi.com");

// The one canonical builder for a Home/resident invitation's activation
// URL. The email link and the QR code must both consume this exact
// result -- never build their own.
export function buildConsumerHomeInviteUrl(rawToken: string): string {
  return `${CONSUMER_APP_URL}/auth/invite?token=${encodeURIComponent(rawToken)}`;
}

// Facility/staff-invite activation URL (estateInvites.controller.ts) --
// same defect class, different destination (the Facility frontend, not
// Consumer) and a different route: staff invites reuse the same
// estate-owner activation page/RPC pair Office's provisioning flow uses
// (facility-oyi's /facility-invite, not Consumer's /auth/invite). Kept
// alongside buildConsumerHomeInviteUrl for the same single-canonical-
// builder reason.
export function buildFacilityStaffInviteUrl(rawToken: string): string {
  return `${FACILITY_APP_URL}/facility-invite?token=${encodeURIComponent(rawToken)}`;
}
