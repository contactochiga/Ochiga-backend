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

// Hardening: what counts as a reply (goal wake / evaluation), and the uninspected-attachment guard on Oyi's answer
const { hasCustomerText } = await import(pathToFileURL(path.join(DIST, "services", "communicationRuntime", "replyClassifier.js")));
ok(hasCustomerText(t.body) && hasCustomerText(v.body) && hasCustomerText(d.body) && !hasCustomerText(i.body) && !hasCustomerText(a.body) && !hasCustomerText("  \n ") && !hasCustomerText(null), "customer text: typed text and captions count; media-only, blank and missing bodies do not");
const g = await import(pathToFileURL(path.join(DIST, "oyi-core", "policy", "inboundAttachmentNotice.js")));
ok(g.inboundAttachmentContext(undefined) === null && g.inboundAttachmentContext({}) === null && g.inboundAttachmentContext({ inbound_message: { attachment_kinds: [] } }) === null && g.inboundAttachmentContext({ inbound_message: { attachment_kinds: ["<b>", 3] } }) === null, "no attachment metadata (website, text turns): no guard");
const ctxImage = g.inboundAttachmentContext({ inbound_message: { message_type: "image", caption_present: true, attachment_kinds: ["image", "image", "evil"] } });
ok(ctxImage && ctxImage.kinds.length === 1 && ctxImage.kinds[0] === "image", "attachment kinds: known kinds only, de-duplicated");
const unchangedWebsite = g.guardAnswerForUninspectedAttachments("I've looked at your photo.", null);
ok(unchangedWebsite.answer === "I've looked at your photo." && unchangedWebsite.notice_applied === false, "website / text turns: answer unchanged");
const claims = [
  "I've looked at your photo and the plot looks great.", "I can see in the image that the roof is damaged.", "Your photo shows a lovely duplex.", "In the picture, the fence is complete.",
  "Having reviewed the attached document, everything is in order.", "I listened to your voice note.", "The video looks like the Lekki site.", "Nice photo!", "From the PDF, the price is clear.", "I have carefully read your document.",
];
ok(claims.every((s) => g.claimsMediaInspection(s)), `claims of inspecting media are recognised (${claims.length} phrasings)`);
const honest = ["Thanks for sending the photo.", "Could you tell me what the photo is of?", "Ochiga develops intelligent places in Lekki.", "I can see why you'd ask about pricing.", "Please share the document's title in text.", "I read your message about the plot."];
ok(honest.every((s) => !g.claimsMediaInspection(s)), "acknowledging receipt, asking about the media and ordinary answers are not treated as claims");
const guarded = g.guardAnswerForUninspectedAttachments("Thanks for reaching out! I've looked at your photo and the plot looks great. The Lekki plots start from a site visit with our team.", ctxImage);
ok(!g.claimsMediaInspection(guarded.answer.split("\n\n")[0]) && guarded.removed_claims === 1 && guarded.answer.startsWith("Thanks for reaching out! The Lekki plots start from a site visit with our team.") && guarded.answer.endsWith("I can't open attachments in this chat, so I haven't seen the photo you sent; my reply is based on your message only.") && guarded.notice_applied, "captioned media: the claim is removed, the rest of the answer is kept, the not-inspected notice is appended");
const allClaims = g.guardAnswerForUninspectedAttachments("Your photo shows a lovely duplex.", g.inboundAttachmentContext({ inbound_message: { attachment_kinds: ["document", "audio"] } }));
ok(allClaims.answer === "I can't open attachments in this chat, so I haven't seen the document and audio message you sent; my reply is based on your message only.", "an answer made only of claims is replaced by the notice alone");
const clean = g.guardAnswerForUninspectedAttachments("Our team can arrange a site visit.\n\nWould Tuesday work?", ctxImage);
ok(clean.removed_claims === 0 && clean.answer.startsWith("Our team can arrange a site visit.\n\nWould Tuesday work?\n\n"), "an honest answer is kept verbatim (paragraphs preserved) with the notice added");
// the guard runs inside the ONE corporate answer builder the /office/conversation/corporate route uses (real function, canonical runtime result stubbed)
const { buildCorporatePublicResponse } = await import(pathToFileURL(path.join(DIST, "oyi-core", "policy", "corporatePublicConversationPolicy.js")));
const corporateRequest = (metadata) => ({ request_id: "r", message: "Is this plot available?", public_session_id: "s", conversation_thread_id: null, public_identity: "ochiga_intelligence", agent_role: "oma", business_unit: "corporate", inquiry_type: "general_enquiry", source: { source_site: "whatsapp", source_page: "", source_form: null, source_channel: "whatsapp", campaign: {} }, visitor_state: "known", crm_context: { contact_ref: null, opportunity_ref: null, lead_ref: "lead-1", safe_summary: null }, form_context_ref: null, engagement_mode: "text_conversation", handoff_state: "none", requested_capability: null, knowledge_context: [], metadata });
const canonicalReply = { id: "c", thread_id: "t", reply: "I've looked at your photo and it looks great. Our team can confirm availability." };
const withMedia = await buildCorporatePublicResponse(corporateRequest({ inbound_message: { message_type: "image", caption_present: true, attachment_kinds: ["image"] } }), canonicalReply, []);
ok(withMedia.answer === "Our team can confirm availability.\n\nI can't open attachments in this chat, so I haven't seen the photo you sent; my reply is based on your message only." && withMedia.safe_metadata.inbound_attachments.inspected === false && withMedia.safe_metadata.inbound_attachments.notice_applied === true && withMedia.safe_metadata.inbound_attachments.removed_claims === 1, "corporate answer builder: claim removed, notice appended, safe_metadata.inbound_attachments reported");
const websiteTurn = await buildCorporatePublicResponse(corporateRequest({}), { id: "c", thread_id: "t", reply: "Our team can confirm availability." }, []);
ok(websiteTurn.answer === "Our team can confirm availability." && !("inbound_attachments" in websiteTurn.safe_metadata), "corporate answer builder: a turn without attachments is unchanged");

console.log(JSON.stringify({ status: "PASS", suite: "whatsapp-inbound-media-contract", checks }));
