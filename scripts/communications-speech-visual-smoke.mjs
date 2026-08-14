import assert from "node:assert/strict";
import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function check(name, fn) {
  fn();
  console.log(`✓ ${name}`);
}

const contracts = read("src/services/communications/communicationContracts.ts");
const adapters = read("src/services/communications/communicationsMediaAdapters.ts");
const oyiTurn = read("src/services/communications/communicationsOyiTurnService.ts");
const routes = read("src/routes/communications.ts");
const service = read("src/services/communications/communicationsLiveService.ts");
const sockets = read("src/services/communications/communicationsSocketHandlers.ts");
const packageJson = JSON.parse(read("package.json"));

check("speech adapter uses OpenAI transcription and TTS behind an isolated communications boundary", () => {
  assert.match(adapters, /audio\/transcriptions/);
  assert.match(adapters, /audio\/speech/);
  assert.match(adapters, /OPENAI_TRANSCRIPTION_MODEL/);
  assert.match(adapters, /OPENAI_TTS_MODEL/);
  assert.match(adapters, /temporary_audio_deleted: true/);
  assert.doesNotMatch(adapters, /fs\.writeFile|writeFileSync|createWriteStream|multer|diskStorage/);
});

check("visual adapter uses explicit sampled frame analysis, not continuous video ingestion", () => {
  assert.match(adapters, /input_image/);
  assert.match(adapters, /OPENAI_VISION_MODEL/);
  assert.match(adapters, /frame_retention: "ephemeral"/);
  assert.match(adapters, /MAX_IMAGE_BYTES/);
  assert.doesNotMatch(`${adapters}\n${routes}`, /setInterval|requestAnimationFrame|30fps|continuous frame/i);
});

check("voice and visual routes require session consent and expose stable contracts", () => {
  for (const route of [
    "/office-public/session/:sessionId/voice-turn",
    "/office-public/session/:sessionId/visual-observation",
    "/office-internal/session/:sessionId/voice-turn",
    "/office-internal/session/:sessionId/visual-observation",
    "/support/session/:sessionId/voice-turn",
    "/support/session/:sessionId/visual-observation",
  ]) {
    assert.match(routes, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(routes, /assertMicrophoneConsent/);
  assert.match(routes, /assertVisualConsent/);
  assert.match(routes, /oyi_communications\.voice_turn\.v1/);
  assert.match(routes, /oyi_communications\.visual_observation\.v1/);
});

check("failed STT or visual analysis does not create a fake canonical Oyi turn", () => {
  assert.match(routes, /canonical_turn_created: false/);
  assert.match(routes, /speech_transcription_failed/);
  assert.match(routes, /visual_analysis_failed/);
});

check("TTS failure preserves the canonical text response for accessibility and fallback", () => {
  assert.match(routes, /audio_unavailable/);
  assert.match(routes, /text_fallback/);
  assert.match(routes, /response_text: turn\.response_text/);
});

check("voice and visual turns enter the same canonical Oyi Core conversation path", () => {
  assert.match(oyiTurn, /conversationOrchestrator\.run/);
  assert.match(oyiTurn, /public_corporate/);
  assert.match(oyiTurn, /office_internal/);
  assert.match(oyiTurn, /deniedPublicCorporateOperationalRequest/);
  assert.match(oyiTurn, /deniedOfficeInternalOperationalRequest/);
  assert.match(routes, /oyi_thread_id/);
  assert.match(routes, /communications_session_id/);
  assert.match(routes, /public_session_id/);
});

check("visual observations do not grant extra operational authority", () => {
  assert.match(oyiTurn, /visual_observation/);
  assert.match(oyiTurn, /surface_policy/);
  assert.match(oyiTurn, /operation_class_hint: "read"/);
  assert.match(oyiTurn, /scope_mode_hint: "global"/);
});

check("communications events record safe media lifecycle metadata only", () => {
  assert.match(contracts, /voice\.transcribed/);
  assert.match(contracts, /visual\.observed/);
  assert.match(contracts, /oyi\.responded/);
  assert.match(service, /recordOyiMediaTurn/);
  assert.doesNotMatch(`${service}\n${routes}`, /raw_audio|raw_frame|raw_media|sdp|ice_candidate|TURN credential/i);
});

check("Twilio remains TURN/ICE only with no Programmable Voice, Twilio Video, or SFU dependency", () => {
  const combined = `${contracts}\n${adapters}\n${routes}\n${service}\n${sockets}`;
  assert.doesNotMatch(combined, /Programmable Voice|VoiceGrant|Twiml|TwiML|twilio-video|VideoGrant|Room\.create|SFU/i);
  assert.equal(Boolean(packageJson.dependencies?.["twilio-video"]), false);
  assert.equal(Boolean(packageJson.dependencies?.twilio), false);
});

console.log("communications-speech-visual-smoke passed");
