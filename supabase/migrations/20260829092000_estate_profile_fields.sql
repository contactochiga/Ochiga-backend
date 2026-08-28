-- Phase 2 commercial-hardening: Facility Profile fields. `estates` already
-- has name/address/lat/lng/type (lat/lng exist but were never surfaced in
-- any UI, editable or not). Adding timezone (explicitly authorized --
-- "part of core Facility identity/location, do not integrate a weather
-- provider yet") plus contact_email/contact_phone, both genuinely requested
-- customer-editable profile fields. Purely additive, all nullable, no
-- backfill required, no existing row touched.

alter table if exists estates
  add column if not exists timezone text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text;
