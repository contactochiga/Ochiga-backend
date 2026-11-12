#!/usr/bin/env node
// Slice 3.1/3.2 -- the Office -> Backend WhatsApp media contract, Backend side, against the compiled normalizer (no database, no network). Proves that the
// additive fields (message_type, caption, attachments) are mapped into the canonical inbound event without ever turning media into customer text, that an
// older Office payload produces exactly what it produced before, that a STOP caption reaches the opt-out check, and that no URL or bytes survive. The same
// contract against a real PostgreSQL (persistence, opt-out, duplicates, replay, goal wake) is section H of whatsapp-inbound-persistence-postgres-smoke.mjs.
// Run `npm run build` first.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DIST = path.join(ROOT, "dist");
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "media-contract-local-only";
delete process.env.OPENAI_API_KEY;
const m = await import(pathToFileURL(path.join(DIST, "services", "communicationRuntime", "whatsappInboundMessage.js")));
const { quickUnsubscribeCheck, classifyInboundReply } = await import(pathToFileURL(path.join(DIST, "services", "communicationRuntime", "replyClassifier.js")));

let checks = 0;
const ok = (cond, name) => { assert.ok(cond, name); checks += 1; console.log(`PASS ${name}`); };

// Contract examples exactly as Office (whatsapp-media.js backendMessageFields) sends them
const officeText = { channel: "whatsapp", provider_event_type: "message", provider_message_id: "wamid.T", from: "2348011111111", text: "Hello", message_type: "text", lead_id: "lead-1", occurred_at: "2026-11-13T09:00:00.000Z" };
const officeImageNoCaption = { ...officeText, provider_message_id: "wamid.I", text: "", message_type: "image", attachments: [{ kind: "image", provider_media_id: "1234567890", mime_type: "image/jpeg", size_bytes: null, sha256: "kXJ1vO8u=", filename: null, voice: false, animated: false }] };
const officeVideoStop = { ...officeText, provider_message_id: "wamid.V", text: "", message_type: "video", caption: "STOP", attachments: [{ kind: "video", provider_media_id: "222", mime_type: "video/mp4", size_bytes: null, sha256: null, filename: null, voice: false, animated: false }] };
const officeVoice = { ...officeText, provider_message_id: "wamid.A", text: "", message_type: "audio", attachments: [{ kind: "audio", provider_media_id: "333", mime_type: "audio/ogg; codecs=opus", size_bytes: 4096, sha256: "z=", filename: null, voice: true, animated: false }] };
const officeDocument = { ...officeText, provider_message_id: "wamid.D", text: "", message_type: "document", caption: "Signed contract", attachments: [{ kind: "document", provider_media_id: "444", mime_type: "application/pdf", size_bytes: 52000, sha256: "y=", filename: "Contract.pdf", voice: false, animated: false }] };
const olderOffice = { channel: "whatsapp", provider_event_type: "message", provider_message_id: "wamid.O", from: "2348011111111", text: "Hello from an older Office", lead_id: "lead-1", occurred_at: "2026-11-13T09:00:00.000Z" };

const t = m.normalizeWhatsAppInboundMessage(officeText);
ok(t.body === "Hello" && t.body_source === "text" && t.message_type === "text" && t.caption === null && t.attachments === null, "text: body is the typed text, nothing else added");
const o = m.normalizeWhatsAppInboundMessage(olderOffice);
ok(o.body === "Hello from an older Office" && o.message_type === "text" && o.attachments === null && o.caption === null, "older Office payload: identical to the previous mapping (text body, type text, no attachments)");
ok(m.normalizeWhatsAppInboundMessage({ text: "   " }).body === "   ", "older Office whitespace-only text: stored exactly as before");
const i = m.normalizeWhatsAppInboundMessage(officeImageNoCaption);
ok(i.body === "" && i.body_source === "none" && i.message_type === "image" && i.attachments.length === 1 && i.attachments[0].url === null && i.attachments[0].content_type === "image/jpeg" && i.attachments[0].provider_media_id === "1234567890", "media without caption: empty body (no placeholder), type and metadata kept, url null");
const v = m.normalizeWhatsAppInboundMessage(officeVideoStop);
ok(v.body === "STOP" && v.body_source === "caption" && v.caption === "STOP" && v.message_type === "video", "caption without text becomes the body (customer-authored) and is kept as caption");
ok(quickUnsubscribeCheck(v.body) === true, "a STOP caption reaches the opt-out check");
ok((await classifyInboundReply(v.body)).outcome === "unsubscribe" && (await classifyInboundReply(i.body)).outcome === "unknown", "classification: STOP caption = unsubscribe; media without text = unknown (no AI call)");
const a = m.normalizeWhatsAppInboundMessage(officeVoice);
ok(a.attachments[0].voice === true && a.attachments[0].mime_type === "audio/ogg; codecs=opus" && a.body === "", "voice note: voice flag kept, no transcription, empty body");
const d = m.normalizeWhatsAppInboundMessage(officeDocument);
ok(d.attachments[0].filename === "Contract.pdf" && d.body === "Signed contract", "document: filename and caption kept");
ok(m.normalizeWhatsAppInboundMessage({ text: "typed", caption: "caption" }).body === "typed" && m.normalizeWhatsAppInboundMessage({ text: "typed", caption: "caption" }).caption === "caption", "typed text wins as body; the caption is still kept separately");
ok(m.normalizeInboundMessageType("location") === "location" && m.normalizeInboundMessageType("<script>") === "unknown" && m.normalizeInboundMessageType(undefined) === "text", "message_type: provider value, unknown for garbage, text when absent");
const hostile = m.normalizeInboundAttachments([{ kind: "document", provider_media_id: "x", filename: "../../etc/passwd", url: "https://lookaside.fbsbx.com/x", mime_type: "text/html<script>", size_bytes: -1, voice: true }]);
ok(hostile[0].filename === "passwd" && hostile[0].url === null && hostile[0].mime_type === null && hostile[0].size_bytes === null && hostile[0].voice === false, "attachments: path stripped, URL nulled, bad MIME/size dropped, voice only for audio");
ok(m.normalizeInboundAttachments("not-an-array") === null && m.normalizeInboundAttachments([]) === null && m.normalizeInboundAttachments([{ kind: "image" }]) === null, "attachments: nothing usable means null (as before)");
ok(!JSON.stringify([t, o, i, v, a, d]).match(/https?:|data:|lookaside/), "no URL of any kind in any normalized message");

console.log(JSON.stringify({ status: "PASS", suite: "whatsapp-inbound-media-contract", checks }));
