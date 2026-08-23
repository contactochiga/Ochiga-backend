import crypto from "crypto";
import type { CommunicationConsent, CommunicationSurface } from "./communicationContracts";

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const OPENAI_API_BASE = "https://api.openai.com/v1";

type ParsedDataUrl = {
  mimeType: string;
  buffer: Buffer;
};

export type CommunicationSpeechTranscript = {
  transcript: string;
  language: string | null;
  confidence: number | null;
  provider: "openai_audio_transcription";
  model: string;
  temporary_audio_deleted: true;
};

export type CommunicationSpeechAudio = {
  audio_data_url: string;
  mime_type: string;
  provider: "openai_text_to_speech";
  model: string;
  voice: string;
};

export type CommunicationVisualObservationAnalysis = {
  observation_id: string;
  summary: string;
  visible_objects: string[];
  visible_text: string[];
  uncertainty: string | null;
  safety_limitations: string[];
  provider: "openai_multimodal";
  model: string;
  frame_retention: "ephemeral";
};

export type CommunicationDocumentAnalysis = {
  observation_id: string;
  summary: string;
  key_points: string[];
  document_type_guess: string | null;
  uncertainty: string | null;
  provider: "openai_multimodal";
  model: string;
  filename: string;
};

const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
const DOCUMENT_MIME_KIND: Record<string, "file" | "text" | "image"> = {
  "application/pdf": "file",
  "text/plain": "text",
  "text/csv": "text",
  "text/markdown": "text",
  "application/json": "text",
  "image/jpeg": "image",
  "image/jpg": "image",
  "image/png": "image",
  "image/webp": "image",
};

function openAiKey() {
  return process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || "";
}

function parseDataUrl(value: unknown, allowed: RegExp, maxBytes: number, label: string): ParsedDataUrl {
  const raw = String(value || "");
  const match = raw.match(/^data:([^;]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) throw new Error(`${label}_data_url_required`);
  const mimeType = match[1].toLowerCase();
  if (!allowed.test(mimeType)) throw new Error(`${label}_mime_not_supported`);
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (!buffer.length) throw new Error(`${label}_empty`);
  if (buffer.byteLength > maxBytes) throw new Error(`${label}_too_large`);
  return { mimeType, buffer };
}

function requireOpenAi() {
  const apiKey = openAiKey();
  if (!apiKey) throw new Error("openai_api_key_not_configured");
  return apiKey;
}

function safeJsonObject(text: string): Record<string, any> {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
}

export function assertMicrophoneConsent(consent: CommunicationConsent | undefined, explicitConsent?: boolean) {
  if (!Boolean(consent?.microphone || explicitConsent)) throw new Error("microphone_consent_required");
}

export function assertVisualConsent(consent: CommunicationConsent | undefined, explicitCamera?: boolean, explicitVisual?: boolean) {
  if (!Boolean(consent?.camera || explicitCamera)) throw new Error("camera_consent_required");
  if (!Boolean(consent?.visual_analysis || explicitVisual)) throw new Error("visual_analysis_consent_required");
}

export async function transcribeCommunicationAudio(input: {
  audio_data_url: string;
  filename?: string | null;
}): Promise<CommunicationSpeechTranscript> {
  const apiKey = requireOpenAi();
  const model = process.env.OPENAI_TRANSCRIPTION_MODEL || process.env.OPENAI_AUDIO_TRANSCRIPTION_MODEL || "whisper-1";
  const { mimeType, buffer } = parseDataUrl(input.audio_data_url, /^audio\/(webm|mpeg|mp3|mp4|m4a|wav|ogg)$/i, MAX_AUDIO_BYTES, "audio");
  const extension = mimeType.split("/")[1].replace("mpeg", "mp3");
  const fileBytes = Uint8Array.from(buffer);
  const form = new FormData();
  form.append("model", model);
  form.append("file", new Blob([fileBytes.buffer], { type: mimeType }), input.filename || `oyi-voice-turn.${extension}`);
  form.append("response_format", "verbose_json");

  const response = await fetch(`${OPENAI_API_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form as any,
  });
  if (!response.ok) throw new Error(`speech_transcription_failed:${response.status}`);
  const payload = await response.json() as Record<string, any>;
  const transcript = String(payload.text || "").trim();
  if (!transcript) throw new Error("speech_transcription_empty");
  return {
    transcript,
    language: payload.language ? String(payload.language) : null,
    confidence: typeof payload.confidence === "number" ? payload.confidence : null,
    provider: "openai_audio_transcription",
    model,
    temporary_audio_deleted: true,
  };
}

export async function synthesizeOyiSpeech(input: { text: string }): Promise<CommunicationSpeechAudio> {
  const apiKey = requireOpenAi();
  const text = String(input.text || "").trim();
  if (!text) throw new Error("speech_synthesis_text_required");
  const model = process.env.OPENAI_TTS_MODEL || process.env.OPENAI_SPEECH_MODEL || "gpt-4o-mini-tts";
  const voice = process.env.OPENAI_TTS_VOICE || process.env.OPENAI_SPEECH_VOICE || "alloy";
  const response = await fetch(`${OPENAI_API_BASE}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      voice,
      input: text.slice(0, 8000),
      format: "mp3",
    }),
  });
  if (!response.ok) throw new Error(`speech_synthesis_failed:${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (!buffer.length) throw new Error("speech_synthesis_empty");
  return {
    audio_data_url: `data:audio/mpeg;base64,${buffer.toString("base64")}`,
    mime_type: "audio/mpeg",
    provider: "openai_text_to_speech",
    model,
    voice,
  };
}

export async function analyzeCommunicationFrame(input: {
  image_data_url: string;
  prompt?: string | null;
  surface: CommunicationSurface;
  communications_session_id: string;
  source_participant_id: string;
}): Promise<CommunicationVisualObservationAnalysis> {
  const apiKey = requireOpenAi();
  const model = process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MULTIMODAL_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const { mimeType, buffer } = parseDataUrl(input.image_data_url, /^image\/(jpeg|jpg|png|webp)$/i, MAX_IMAGE_BYTES, "image");
  const imageDataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
  const instruction = [
    "Analyze this single user-supplied frame for an Oyi conversation.",
    "Return compact JSON only with keys: summary, visible_objects, visible_text, uncertainty, safety_limitations.",
    "Preserve uncertainty. Do not claim hidden operational access. Do not expose secrets.",
    input.prompt ? `User question/context: ${input.prompt}` : "",
    `Surface: ${input.surface}; communications_session_id: ${input.communications_session_id}.`,
  ].filter(Boolean).join("\n");

  const response = await fetch(`${OPENAI_API_BASE}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: instruction },
          { type: "input_image", image_url: imageDataUrl },
        ],
      }],
    }),
  });
  if (!response.ok) throw new Error(`visual_analysis_failed:${response.status}`);
  const payload = await response.json() as Record<string, any>;
  const output = Array.isArray(payload.output) ? payload.output : [];
  const outputText = output
    .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
    .map((part: any) => String(part?.text || part?.output_text || ""))
    .filter(Boolean)
    .join("\n");
  const text = String(payload.output_text || outputText || "");
  const parsed = safeJsonObject(text);
  const asStrings = (value: unknown) => Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 20) : [];
  return {
    observation_id: `visual_obs_${crypto.randomUUID()}`,
    summary: String(parsed.summary || text || "The frame was analyzed, but no reliable summary was returned.").slice(0, 1200),
    visible_objects: asStrings(parsed.visible_objects),
    visible_text: asStrings(parsed.visible_text),
    uncertainty: parsed.uncertainty ? String(parsed.uncertainty).slice(0, 500) : null,
    safety_limitations: asStrings(parsed.safety_limitations),
    provider: "openai_multimodal",
    model,
    frame_retention: "ephemeral",
  };
}

// Reuses the exact same proven OpenAI Responses multimodal pattern as
// analyzeCommunicationFrame (same endpoint, same model family, same
// auth) -- extended to file input instead of a camera frame. PDFs go
// through as input_file (the model reads the document directly, no
// separate OCR step); plain text-shaped files are decoded and sent as
// input_text; images are accepted as a convenience via input_image.
// Any other MIME type is honestly rejected -- never claims to have
// read a file type it cannot actually understand.
export async function analyzeCommunicationDocument(input: {
  file_data_url: string;
  filename: string;
  prompt?: string | null;
  surface: CommunicationSurface;
}): Promise<CommunicationDocumentAnalysis> {
  const apiKey = requireOpenAi();
  const model = process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MULTIMODAL_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const match = String(input.file_data_url || "").match(/^data:([^;]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) throw new Error("document_data_url_required");
  const mimeType = match[1].toLowerCase();
  const kind = DOCUMENT_MIME_KIND[mimeType];
  if (!kind) throw new Error(`document_type_unsupported:${mimeType}`);
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (!buffer.length) throw new Error("document_empty");
  if (buffer.byteLength > MAX_DOCUMENT_BYTES) throw new Error("document_too_large");

  const instruction = [
    "Analyze this single staff-supplied file for an Oyi Office Intelligence conversation.",
    "Return compact JSON only with keys: summary, key_points (array), document_type_guess, uncertainty.",
    "If the file appears to relate to a lead, proposal, project, financial, task, report, or customer record, say so in the summary so Office staff can decide what to do next — but never claim to have taken any action on it.",
    input.prompt ? `User question/context: ${input.prompt}` : "",
    `Surface: ${input.surface}.`,
  ].filter(Boolean).join("\n");

  const content: Record<string, unknown>[] = [{ type: "input_text", text: instruction }];
  if (kind === "file") {
    content.push({ type: "input_file", filename: input.filename || "document.pdf", file_data: input.file_data_url });
  } else if (kind === "image") {
    content.push({ type: "input_image", image_url: input.file_data_url });
  } else {
    const text = buffer.toString("utf8").slice(0, 40_000);
    content.push({ type: "input_text", text: `File contents (${input.filename || "file"}):\n${text}` });
  }

  const response = await fetch(`${OPENAI_API_BASE}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: [{ role: "user", content }] }),
  });
  if (!response.ok) throw new Error(`document_analysis_failed:${response.status}`);
  const payload = await response.json() as Record<string, any>;
  const output = Array.isArray(payload.output) ? payload.output : [];
  const outputText = output
    .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
    .map((part: any) => String(part?.text || part?.output_text || ""))
    .filter(Boolean)
    .join("\n");
  const text = String(payload.output_text || outputText || "");
  const parsed = safeJsonObject(text);
  const asStrings = (value: unknown) => Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 20) : [];
  return {
    observation_id: `doc_obs_${crypto.randomUUID()}`,
    summary: String(parsed.summary || text || "The file was analyzed, but no reliable summary was returned.").slice(0, 1500),
    key_points: asStrings(parsed.key_points),
    document_type_guess: parsed.document_type_guess ? String(parsed.document_type_guess).slice(0, 120) : null,
    uncertainty: parsed.uncertainty ? String(parsed.uncertainty).slice(0, 500) : null,
    provider: "openai_multimodal",
    model,
    filename: input.filename || "document",
  };
}
